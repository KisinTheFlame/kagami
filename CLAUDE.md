# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概述

Kagami 是一个基于 TypeScript 构建的 QQ 群聊机器人，集成了 LLM 功能用于智能聊天回复。项目使用 node-napcat-ts 库进行 QQ 集成，使用 OpenAI API 提供语言模型功能。

## 开发命令

### 构建和运行
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
