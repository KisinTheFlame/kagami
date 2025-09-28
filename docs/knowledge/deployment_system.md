# 部署系统

## 定义

Kagami 部署系统是基于 Docker 多容器架构的部署解决方案，为机器人、控制台前后端和数据库提供统一的容器化环境。采用标准化的镜像版本管理，确保构建的可重复性和稳定性。

## 容器化架构

### 服务组成
```
Kagami Deployment System
├── kagami-bot/              # QQ 机器人服务容器
│   ├── Node.js 24-alpine3.21
│   ├── TypeScript 构建
│   └── Prisma 运行时集成
├── kagami-console/          # Go 后端 API 容器
│   ├── Go 1.25.1-alpine3.22 构建
│   ├── Alpine 3.21.4 运行时
│   └── 静态二进制程序
├── kagami-console-web/      # React 前端容器
│   ├── Node.js 24-alpine3.21 构建
│   ├── Nginx 1.29.1-alpine 托管
│   └── 静态文件部署
└── PostgreSQL 16           # 数据库服务
    ├── 官方 PostgreSQL 镜像
    └── 持久化存储
```

## Docker 镜像标准化

### kagami-bot 容器配置
```dockerfile
# 构建阶段
FROM node:24-alpine3.21 AS builder
# - Node.js 24 LTS 版本
# - Alpine Linux 3.21 基础镜像
# - 用于 TypeScript 编译和依赖安装

# 生产阶段
FROM node:24-alpine3.21 AS production
# - 相同基础镜像确保环境一致性
# - 多阶段构建减少镜像体积
# - 非 root 用户运行提升安全性
```

### kagami-console 容器配置
```dockerfile
# 构建阶段
FROM golang:1.25.1-alpine3.22 AS builder
# - Go 1.25.1 精确版本
# - Alpine 3.22 构建环境
# - CGO_ENABLED=0 静态编译

# 生产阶段
FROM alpine:3.21.4 AS production
# - 最小化 Alpine 运行时
# - 精确版本 3.21.4
# - 包含 ca-certificates、tzdata、curl
```

### kagami-console-web 容器配置
```dockerfile
# 构建阶段
FROM node:24-alpine3.21 AS builder
# - 与机器人服务统一 Node.js 版本
# - React + Vite 构建环境
# - npm 依赖管理

# 生产阶段
FROM nginx:1.29.1-alpine AS production
# - 精确 Nginx 版本 1.29.1
# - Alpine 基础镜像
# - 静态文件托管优化
```

## 版本策略

### 镜像版本管理原则
- **精确版本号**: 避免 `latest`、`alpine` 等浮动标签
- **一致性**: 同类型服务使用统一的基础镜像版本
- **稳定性**: 选择 LTS 或稳定版本
- **安全性**: 定期更新到最新安全版本

### 版本对应关系
```
服务类型           构建镜像                 运行镜像
kagami-bot        node:24-alpine3.21      node:24-alpine3.21
kagami-console    golang:1.25.1-alpine3.22  alpine:3.21.4
kagami-console-web node:24-alpine3.21      nginx:1.29.1-alpine
PostgreSQL        -                       postgres:16
```

## 构建流程

### 多阶段构建策略
1. **构建阶段**: 包含完整开发工具链
   - 源码编译
   - 依赖下载和构建
   - 静态资源生成

2. **生产阶段**: 最小化运行时环境
   - 仅包含运行时依赖
   - 移除构建工具和源码
   - 优化镜像体积

### kagami-bot 构建特殊处理
```dockerfile
# Prisma 二进制文件复制
RUN cp src/generated/prisma/libquery*.node dist/generated/prisma/
```
- 手动复制 Prisma 查询引擎二进制文件
- 确保 PostgreSQL 运行时依赖完整
- 支持数据库连接和 ORM 操作

## Make 构建命令

### 统一构建接口
```bash
make build    # 构建所有服务镜像
make up       # 构建并启动所有容器
make down     # 停止所有容器服务
make status   # 查看服务运行状态
make clean    # 清理构建产物
```

### 并行构建优化
- 利用 Docker BuildKit 并行构建
- 多阶段构建缓存优化
- 服务间独立构建，避免级联影响

## 网络架构

### 服务通信
```
外部访问:
  前端控制台: http://localhost:10000
  后端API:    http://localhost:8080
  数据库:     localhost:5432
  NapCat:     localhost:6099

内部网络:
  kagami-bot ↔ PostgreSQL  (数据库连接)
  kagami-bot ↔ NapCat      (QQ协议连接)
  kagami-console ↔ PostgreSQL (只读查询)
  kagami-console-web → kagami-console (API调用)
```

### 端口映射
- **10000**: 前端控制台 (nginx)
- **8080**: 后端 API (gin)
- **5432**: PostgreSQL 数据库
- **6099**: NapCat QQ 协议服务

## 数据持久化

### 数据卷管理
```yaml
volumes:
  postgresql_data:
    # PostgreSQL 数据持久化
  napcat_config:
    # NapCat 配置和状态
```

### 数据备份策略
- PostgreSQL 定期备份
- 配置文件版本控制
- 日志文件轮转和归档

## 性能优化

### 镜像优化
- **多阶段构建**: 分离构建和运行环境
- **层缓存**: 优化 Dockerfile 指令顺序
- **基础镜像选择**: Alpine Linux 最小化体积
- **依赖管理**: 精确版本避免意外更新

### 运行时优化
- **非 root 用户**: 提升容器安全性
- **健康检查**: 容器服务状态监控
- **资源限制**: CPU 和内存使用控制

## 安全策略

### 容器安全
- **最小权限**: 非 root 用户运行
- **网络隔离**: 服务间最小化网络暴露
- **镜像扫描**: 定期扫描安全漏洞
- **秘钥管理**: 环境变量或秘钥文件注入

### 版本安全
- **CVE 跟踪**: 关注基础镜像安全更新
- **定期更新**: 按计划更新到安全版本
- **漏洞修复**: 及时响应安全漏洞

## 部署环境

### 开发环境
```bash
# 本地开发部署
docker-compose up -d
```

### 生产环境
```bash
# 生产环境部署
make build && make up
```

### 环境差异
- **配置文件**: 通过环境变量或配置文件区分
- **数据库**: 开发/生产数据库分离
- **日志级别**: 生产环境降低日志详细度

## 监控和调试

### 日志管理
```bash
# 查看服务日志
docker-compose logs kagami-bot
docker-compose logs kagami-console
docker-compose logs kagami-console-web
```

### 容器调试
```bash
# 进入容器调试
docker exec -it kagami-bot sh
docker exec -it kagami-console sh
```

## 扩展规划

### 水平扩展
- **负载均衡**: Nginx 反向代理多实例
- **数据库集群**: PostgreSQL 主从复制
- **缓存层**: Redis 缓存热点数据

### 云原生部署
- **Kubernetes**: 容器编排和自动扩展
- **Helm Charts**: 标准化部署配置
- **CI/CD**: 自动化构建和部署流水线

## 依赖关系

### 基础设施依赖
- [[database_layer]] - PostgreSQL 数据库服务
- [[console_system]] - Web 控制台部署架构

### 配置依赖
- [[config_system]] - 环境配置和参数管理

## 相关文件
- `kagami-bot/Dockerfile` - 机器人容器配置
- `kagami-console/Dockerfile` - 后端 API 容器配置
- `kagami-console-web/Dockerfile` - 前端容器配置
- `docker-compose.yml` - 多容器编排配置
- `Makefile` - 统一构建命令接口