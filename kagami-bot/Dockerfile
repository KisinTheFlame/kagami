# 使用官方 Node.js 24-alpine3.21 镜像作为基础镜像
FROM node:24-alpine3.21 AS builder

# 设置工作目录
WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

# 第 1 层：复制 workspace 配置文件和所有子项目的 package.json
# 这一层只有在依赖变化时才会失效
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY kagami-bot/package.json ./kagami-bot/
COPY kagami-console-web/package.json ./kagami-console-web/

# 第 2 层：只安装当前项目的依赖（会被缓存）
# 使用 --filter 避免安装其他子项目的依赖，减小镜像大小
RUN pnpm install --frozen-lockfile --filter kagami-bot

# 第 3 层：复制源代码
# 代码修改只会导致这一层及之后的层失效，前面的依赖安装层仍然有效
COPY . .

# 第 4 层：构建指定子项目
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

# 复制 workspace 配置文件和所有子项目的 package.json
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY kagami-bot/package.json ./kagami-bot/
COPY kagami-console-web/package.json ./kagami-console-web/

# 安装生产依赖
RUN pnpm install --prod --frozen-lockfile --filter kagami-bot && pnpm store prune

# 从构建阶段复制编译后的文件
COPY --from=builder --chown=kagami:nodejs /app/kagami-bot/dist ./kagami-bot/dist
COPY --from=builder --chown=kagami:nodejs /app/kagami-bot/static ./kagami-bot/static
COPY --from=builder --chown=kagami:nodejs /app/kagami-bot/env.yaml ./kagami-bot/env.yaml

# 切换到非 root 用户
USER kagami

# 启动应用
CMD ["node", "kagami-bot/dist/main.js", "--config", "kagami-bot/env.yaml", "--prompt", "kagami-bot/static/prompt.txt"]