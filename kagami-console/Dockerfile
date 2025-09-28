# 使用官方 Go 镜像作为构建阶段
FROM golang:1.25.1-alpine3.22 AS builder

# 设置工作目录
WORKDIR /app

# 安装必要的包
RUN apk add --no-cache git

# 复制 go.mod 和 go.sum
COPY go.mod go.sum ./

# 下载依赖
RUN go mod download

# 复制源代码
COPY . .

# 构建应用
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main ./cmd/api

# 生产阶段 - 使用更小的 alpine 镜像
FROM alpine:3.21.4 AS production

# 安装必要的证书、时区数据和 curl
RUN apk --no-cache add ca-certificates tzdata curl

# 创建非 root 用户
RUN addgroup -g 1001 -S kagami && \
    adduser -S kagami -u 1001 -G kagami

# 设置工作目录
WORKDIR /app

# 从构建阶段复制可执行文件
COPY --from=builder --chown=kagami:kagami /app/main .

# 复制配置文件目录（如果需要）
COPY --from=builder --chown=kagami:kagami /app/scripts ./scripts

# 切换到非 root 用户
USER kagami

# 设置环境变量
ENV GIN_MODE=release

# 暴露端口
EXPOSE 8080

# 启动应用
CMD ["./main"]