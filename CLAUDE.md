# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概述

Kagami 是一个基于 TypeScript 构建的 QQ 群聊机器人，集成了 LLM 功能用于智能聊天回复。项目采用多服务容器化架构，包含：

- **kagami-bot**: TypeScript QQ 机器人服务（包含 HTTP API）
- **kagami-console-web**: React 前端控制台
- **PostgreSQL**: 数据库服务
- **NapCat**: QQ 协议服务

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
make build             # 构建所有服务（kagami-bot, kagami-console-web）
make up                # 构建并启动所有容器服务
make down              # 停止所有容器服务
make status            # 查看服务状态
```

### 代码质量
```bash
make lint              # 对所有服务运行代码检查（ESLint）
make clean             # 清理构建产物
```

## 技术栈

- **kagami-bot**: TypeScript, Node.js, Express, PostgreSQL (Prisma ORM)
- **kagami-console-web**: React, TypeScript, Vite, nginx
- **数据库**: PostgreSQL 16
- **容器化**: Docker, Docker Compose
