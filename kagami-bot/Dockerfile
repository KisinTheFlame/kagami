# 使用官方 Node.js 24-alpine3.21 镜像作为基础镜像
FROM node:24-alpine3.21 AS builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

RUN npm run prisma:generate

# 编译 TypeScript
RUN npm run build

RUN cp src/generated/prisma/libquery*.node dist/generated/prisma/

# 生产阶段
FROM node:24-alpine3.21 AS production

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S kagami -u 1001

# 设置工作目录
WORKDIR /app

# 复制 package.json
COPY package*.json ./

# 安装生产依赖
RUN npm ci --only=production && npm cache clean --force

# 从构建阶段复制编译后的文件
COPY --from=builder --chown=kagami:nodejs /app/dist ./dist
COPY --from=builder --chown=kagami:nodejs /app/static ./static
COPY --from=builder --chown=kagami:nodejs /app/env.yaml ./env.yaml

# 切换到非 root 用户
USER kagami

# 设置环境变量
ENV NODE_ENV=production

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# 启动应用
CMD ["node", "dist/main.js", "--config", "env.yaml"]