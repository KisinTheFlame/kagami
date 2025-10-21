# 使用官方 Node.js 24-alpine3.21 镜像作为基础镜像
FROM node:24-alpine3.21 AS builder

# 设置工作目录
WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

# 第 1 层：复制 workspace 配置文件
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# 第 2 层：复制 kagami-types 的配置和源代码，先构建它
COPY kagami-types/package.json ./kagami-types/
RUN pnpm install --frozen-lockfile --filter kagami-types
COPY kagami-types/tsconfig.json ./kagami-types/
COPY kagami-types/src ./kagami-types/src
RUN pnpm --filter kagami-types build

# 第 3 层：复制其他子项目的 package.json 并安装依赖
# 此时 kagami-types 已经构建完成，pnpm 可以正确链接
COPY kagami-bot/package.json ./kagami-bot/
COPY kagami-console-web/package.json ./kagami-console-web/
RUN pnpm install --frozen-lockfile --filter kagami-bot

# 第 4 层：复制 kagami-bot 源代码
COPY kagami-bot ./kagami-bot

# 第 5 层：构建 kagami-bot
RUN pnpm --filter kagami-bot prisma:generate

RUN pnpm --filter kagami-bot compile

RUN cp kagami-bot/src/generated/prisma/libquery*.node kagami-bot/dist/generated/prisma/

# 生产阶段
FROM node:24-alpine3.21 AS production

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S kagami -u 1001

# 设置工作目录
WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

# 复制 workspace 配置文件
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# 先复制并安装 kagami-types（需要先有构建产物）
COPY kagami-types/package.json ./kagami-types/
COPY --from=builder /app/kagami-types/dist ./kagami-types/dist

# 复制其他子项目的 package.json
COPY kagami-bot/package.json ./kagami-bot/
COPY kagami-console-web/package.json ./kagami-console-web/

# 安装生产依赖（包括 kagami-types 和 kagami-bot）
RUN pnpm install --prod --frozen-lockfile --filter kagami-types --filter kagami-bot && pnpm store prune

# 从构建阶段复制编译后的文件
COPY --from=builder --chown=kagami:nodejs /app/kagami-bot/dist ./kagami-bot/dist
COPY --from=builder --chown=kagami:nodejs /app/kagami-bot/static ./kagami-bot/static
COPY --from=builder --chown=kagami:nodejs /app/kagami-bot/env.yaml ./kagami-bot/env.yaml

# 切换到非 root 用户
USER kagami

# 启动应用
CMD ["node", "kagami-bot/dist/main.js", "--config", "kagami-bot/env.yaml", "--prompt", "kagami-bot/static/prompt.txt"]