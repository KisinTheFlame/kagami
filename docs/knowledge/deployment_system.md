# 部署系统

## 定义

Kagami 部署系统是基于 Docker 多容器架构的部署解决方案，为机器人、控制台前后端和数据库提供统一的容器化环境。采用标准化的镜像版本管理和 **pnpm workspace 感知的构建流程**，确保构建的可重复性、稳定性和高效缓存。

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
# - corepack 管理 pnpm@10.18.3
# - 用于 TypeScript 编译和依赖安装
# - Workspace 感知的分层构建

# 生产阶段
FROM node:24-alpine3.21 AS production
# - 相同基础镜像确保环境一致性
# - 多阶段构建减少镜像体积
# - pnpm --filter 选择性安装依赖
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
# - corepack 管理 pnpm@10.18.3
# - Workspace 感知的分层构建

# 生产阶段
FROM nginx:1.29.1-alpine AS production
# - 精确 Nginx 版本 1.29.1
# - Alpine 基础镜像
# - 静态文件托管优化
# - Content-Type 响应头优化
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

### Workspace 感知的多阶段构建

#### 构建上下文变更
```yaml
# docker-compose.yaml
services:
  bot:
    build:
      context: .                    # 从根目录构建（而非子目录）
      dockerfile: kagami-bot/Dockerfile

  console-web:
    build:
      context: .                    # 从根目录构建（而非子目录）
      dockerfile: kagami-console-web/Dockerfile
```

#### 分层构建策略
1. **第 1 层 - Workspace 配置**: 复制 workspace 配置和所有 package.json
   - 只有依赖变化时才失效
   - 最大化缓存命中率

2. **第 2 层 - 依赖安装**: 使用 `--filter` 选择性安装
   - 仅安装当前子项目所需依赖
   - 减小镜像体积

3. **第 3 层 - 源码复制**: 复制完整源代码
   - 代码修改只影响这一层及之后的层

4. **第 4 层 - 项目构建**: 使用 `--filter` 构建指定子项目
   - 针对性构建，避免构建不需要的子项目

### kagami-bot 构建特殊处理

#### Prisma 二进制文件处理
```dockerfile
# Prisma 生成和二进制文件复制
RUN pnpm --filter kagami-bot prisma:generate
RUN pnpm --filter kagami-bot compile
RUN cp kagami-bot/src/generated/prisma/libquery*.node kagami-bot/dist/generated/prisma/
```
- 使用 `--filter` 针对特定子项目执行 Prisma 生成
- 手动复制 Prisma 查询引擎二进制文件
- 路径调整以适配 workspace 结构

#### 启动命令参数化
```dockerfile
CMD ["node", "kagami-bot/dist/main.js", "--config", "kagami-bot/env.yaml", "--prompt", "kagami-bot/static/prompt.txt"]
```
- 支持命令行参数指定配置和 prompt 文件路径
- 路径前缀适配 workspace 结构

### pnpm 包管理器集成

#### Corepack 管理 pnpm 版本
```dockerfile
# 使用 corepack 启用和固定 pnpm 版本
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
```
- **Corepack**: Node.js 内置的包管理器版本管理工具
- **版本固定**: 确保所有环境使用相同 pnpm 版本（10.18.3）
- **无需全局安装**: 不再使用 `npm install -g pnpm`

#### Workspace 感知的依赖安装
```dockerfile
# 构建阶段 - 复制 workspace 配置
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY kagami-bot/package.json ./kagami-bot/
COPY kagami-console-web/package.json ./kagami-console-web/

# 选择性安装依赖（只安装当前子项目）
RUN pnpm install --frozen-lockfile --filter kagami-bot

# 生产阶段 - 只安装生产依赖
RUN pnpm install --prod --frozen-lockfile --filter kagami-bot && pnpm store prune
```
- **`--filter`**: 只安装指定子项目的依赖，减少不必要的包
- **`--frozen-lockfile`**: 确保依赖版本一致性
- **`pnpm store prune`**: 清理缓存优化镜像体积

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
- **Workspace 分层缓存**: 依赖配置和源代码分层，最大化缓存命中
- **选择性依赖安装**: 使用 `--filter` 只安装需要的依赖
- **基础镜像选择**: Alpine Linux 最小化体积
- **依赖管理**: 精确版本避免意外更新
- **.dockerignore**: 排除不必要文件，减少构建上下文

### 运行时优化
- **非 root 用户**: 提升容器安全性
- **健康检查**: 容器服务状态监控
- **资源限制**: CPU 和内存使用控制
- **环境变量简化**: 移除冗余的 NODE_ENV 配置

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

## Docker 构建优化细节

### .dockerignore 配置
```
# 版本控制
.git
.gitignore

# 开发工具
.vscode
.idea

# 构建产物
**/dist
**/node_modules

# 文档
docs
*.md
!README.md

# 配置文件
.eslintrc*
.prettierrc*

# 日志和临时文件
*.log
*.tmp
*.temp
.DS_Store
```
- **减少构建上下文**: 排除不必要的文件，加速文件传输
- **提升缓存效率**: 避免无关文件变化导致缓存失效
- **保留必要文件**: 白名单方式保留 README.md

### Dockerfile 层顺序优化
1. 基础镜像和 pnpm 安装（很少变化）
2. Workspace 配置和 package.json（依赖变化时失效）
3. 依赖安装（依赖变化时失效）
4. 源代码复制（代码变化时失效）
5. 项目构建（每次代码变化都执行）

### 构建缓存策略
- **依赖层缓存**: 只有 package.json 或 lockfile 变化时才重新安装
- **代码层独立**: 代码修改不影响依赖安装层的缓存
- **分层构建**: 最大化 Docker 层缓存命中率

## 扩展规划

### 水平扩展
- **负载均衡**: Nginx 反向代理多实例
- **数据库集群**: PostgreSQL 主从复制
- **缓存层**: Redis 缓存热点数据

### 云原生部署
- **Kubernetes**: 容器编排和自动扩展
- **Helm Charts**: 标准化部署配置
- **CI/CD**: 自动化构建和部署流水线，利用 Docker 层缓存加速

## 依赖关系

### 基础设施依赖
- [[database_layer]] - PostgreSQL 数据库服务
- [[console_system]] - Web 控制台部署架构
- [[pnpm_migration]] - pnpm workspace 架构和包管理

### 配置依赖
- [[config_system]] - 环境配置和参数管理
- [[config_manager]] - 支持命令行参数的配置管理
- [[prompt_template_manager]] - 支持路径参数的 prompt 模板管理

## 相关文件
- `kagami-bot/Dockerfile` - 机器人容器配置（workspace 感知）
- `kagami-console/Dockerfile` - 后端 API 容器配置
- `kagami-console-web/Dockerfile` - 前端容器配置（workspace 感知）
- `docker-compose.yaml` - 多容器编排配置（调整构建上下文）
- `Makefile` - 统一构建命令接口（委托给 pnpm）
- `.dockerignore` - Docker 构建优化配置
- `pnpm-workspace.yaml` - workspace 配置
- `package.json` - 根目录配置，管理共享依赖