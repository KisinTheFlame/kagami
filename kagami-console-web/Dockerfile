# 构建阶段 - 使用 Node.js 构建 React 应用
FROM node:24-alpine3.21 AS builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 生产阶段 - 使用 nginx 托管静态文件
FROM nginx:1.29.1-alpine AS production

# 创建非 root 用户
RUN addgroup -g 1001 -S kagami && \
    adduser -S kagami -u 1001 -G kagami

# 移除默认的 nginx 配置
RUN rm /etc/nginx/conf.d/default.conf

# 从构建阶段复制构建产物到 nginx 目录
COPY --from=builder --chown=kagami:kagami /app/dist /usr/share/nginx/html

# 复制 nginx 配置文件
COPY --chown=kagami:kagami nginx.conf /etc/nginx/nginx.conf

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