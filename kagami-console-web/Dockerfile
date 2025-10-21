# 构建阶段 - 使用 Node.js 构建 React 应用
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
RUN pnpm install --frozen-lockfile --filter kagami-console-web

# 第 4 层：复制 kagami-console-web 源代码
COPY kagami-console-web ./kagami-console-web

# 第 5 层：构建 kagami-console-web
RUN pnpm --filter kagami-console-web build

# 生产阶段 - 使用 nginx 托管静态文件
FROM nginx:1.29.1-alpine AS production

# 创建非 root 用户
RUN addgroup -g 1001 -S kagami && \
    adduser -S kagami -u 1001 -G kagami

# 移除默认的 nginx 配置
RUN rm /etc/nginx/conf.d/default.conf

# 从构建阶段复制构建产物到 nginx 目录
COPY --from=builder --chown=kagami:kagami /app/kagami-console-web/dist /usr/share/nginx/html

# 复制 nginx 配置文件
COPY --chown=kagami:kagami kagami-console-web/nginx.conf /etc/nginx/nginx.conf

# 设置权限
RUN chown -R kagami:kagami /var/cache/nginx && \
    chown -R kagami:kagami /var/log/nginx && \
    chown -R kagami:kagami /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R kagami:kagami /var/run/nginx.pid

# 切换到非 root 用户
USER kagami

# 暴露端口
EXPOSE 10000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:10000/health || exit 1

# 启动 nginx
CMD ["nginx", "-g", "daemon off;"]