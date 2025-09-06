# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概述

Kagami 是一个基于 TypeScript 构建的 QQ 群聊机器人，集成了 LLM 功能用于智能聊天回复。项目采用多服务容器化架构，包含：

- **kagami-bot**: TypeScript QQ 机器人服务
- **kagami-console**: Go 后端 API 服务  
- **kagami-console-web**: React 前端控制台
- **PostgreSQL**: 数据库服务
- **NapCat**: QQ 协议服务

## Docker 容器化部署

### 快速启动
```bash
make up                # 构建并启动所有容器服务
make down              # 停止所有容器服务
make status            # 查看服务状态
```

### 服务访问地址
```
前端控制台: http://localhost:10000
后端API:    http://localhost:8080
PostgreSQL: localhost:5432
NapCat:     localhost:6099
```

### 数据持久化
- PostgreSQL 数据: Docker volume `postgres-data`
- NapCat 配置: Docker volume `napcat-config` 和 `napcat-qq`

## 开发命令

### 本地构建和运行
```bash
npm run build          # 编译 TypeScript 到 dist/
npm run dev            # 构建并使用开发配置运行
npm start              # 构建并使用生产配置运行
```

### 代码质量
```bash
npm run lint           # 对 src/ 运行 ESLint
npm run lint:fix       # 自动修复 ESLint 问题
```

## 技术栈

- **kagami-bot**: TypeScript, Node.js, PostgreSQL (pg)
- **kagami-console**: Go, Gin, GORM, PostgreSQL
- **kagami-console-web**: React, TypeScript, Vite, nginx
- **数据库**: PostgreSQL 16 (自动初始化表结构)
- **容器化**: Docker, Docker Compose
