# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概述

Kagami 是一个基于 TypeScript 构建的 QQ 群聊机器人，集成了 LLM 功能用于智能聊天回复。项目采用 **pnpm workspace** monorepo 架构和多服务容器化部署，包含：

- **kagami-bot**: TypeScript QQ 机器人服务（包含 HTTP API）
- **kagami-console-web**: React 前端控制台
- **PostgreSQL**: 数据库服务
- **NapCat**: QQ 协议服务

### 项目架构

本项目使用 pnpm workspace 管理多个子项目：

- **根目录**: 管理共享的开发工具依赖（TypeScript、ESLint 等）和全局构建脚本
- **kagami-bot**: 独立的机器人服务，包含自己的运行时依赖和特定开发依赖
- **kagami-console-web**: 独立的前端控制台，包含自己的运行时依赖和特定开发依赖

所有子项目通过 workspace 机制共享开发工具，统一版本管理，提升构建效率。

### 服务访问地址
```
前端控制台: http://localhost:10000
后端API:    http://localhost:8080
PostgreSQL: localhost:5432
NapCat:     localhost:6099
```

## 开发命令

### 本地构建和运行
```bash
# 使用 Makefile（推荐）
make build             # 构建所有服务（委托给 pnpm build）
make lint              # 对所有服务运行代码检查（委托给 pnpm lint）
make clean             # 清理构建产物（委托给 pnpm clean）
make up                # 构建并启动所有容器服务
make down              # 停止所有容器服务
make status            # 查看服务状态

# 或直接使用 pnpm（更灵活）
pnpm build             # 构建所有子项目
pnpm build:bot         # 只构建 kagami-bot
pnpm build:web         # 只构建 kagami-console-web
pnpm lint              # 检查所有子项目
pnpm lint:bot          # 只检查 kagami-bot
pnpm lint:web          # 只检查 kagami-console-web
pnpm clean             # 清理所有子项目
```

## 技术栈

- **包管理**: pnpm workspace (monorepo 架构)
- **kagami-bot**: TypeScript, Node.js, Express, PostgreSQL (Prisma ORM)
- **kagami-console-web**: React, TypeScript, Vite, nginx
- **数据库**: PostgreSQL 16
- **容器化**: Docker, Docker Compose

## 依赖管理

项目使用 pnpm workspace 进行依赖管理：

- **根目录依赖**: 所有子项目共享的开发工具（TypeScript、ESLint、@types/node 等）
- **子项目依赖**: 各子项目独立的运行时依赖和特定开发依赖
- **版本统一**: 共享依赖的版本在根目录统一管理，确保一致性
