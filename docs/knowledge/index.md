# Kagami 知识图谱

## 项目概览

Kagami 是一个多子项目架构的 QQ 群聊机器人系统，包含 QQ 机器人、管理控制台前后端。采用分层架构设计，集成了 LLM 能力和并发控制的统一消息处理器，并提供 Web 控制台进行监控和管理。

## 系统架构

```
Kagami System
├── kagami-bot/              # QQ 群聊机器人 (Node.js + TypeScript)
│   ├── 消息处理引擎
│   ├── LLM 集成
│   └── 数据记录
├── kagami-console/          # 后端 API (Go)
│   ├── LLM 日志查询 API
│   ├── 数据库连接
│   └── CORS 代理
└── kagami-console-web/      # 前端控制台 (React + TypeScript)
    ├── LLM 调用历史界面
    ├── 数据筛选和排序
    └── Ant Design 深色主题
```

## 节点总览

### QQ 机器人 (kagami-bot)
- [[kagami_bot]] - 主应用类，负责初始化和生命周期管理
- [[config_system]] - 配置系统，处理 YAML 配置文件和类型定义
- [[connection_manager]] - 统一的 napcat WebSocket 连接管理
- [[session_manager]] - 多群组会话管理和消息分发
- [[session]] - 单个群组的会话封装

### 控制台系统
- [[console_system]] - Web 控制台整体架构和功能
- [[message_card_component]] - LLM消息卡片展示组件

### 消息处理
- [[message_handler]] - 统一消息处理器，集成 LLM 和并发控制
- [[context_manager]] - 上下文管理器，负责消息历史管理和LLM数据准备

### 支持组件
- [[llm_client_manager]] - LLM 客户端管理器，负责模型降级和统一调用
- [[llm_client]] - 单个 LLM 模型的调用客户端，支持多 LLM 提供商
- [[multi_provider_config]] - 多提供商配置系统，支持灵活的模型选择
- [[api_key_manager]] - 多 API Key 轮询管理
- [[prompt_template_manager]] - Handlebars 提示词模板管理系统
- [[message_data_model]] - 消息数据结构定义
- [[timezone_utils]] - 时区处理工具，提供 Asia/Shanghai 时间戳

### 数据层
- [[database_layer]] - Prisma ORM + PostgreSQL 数据库封装，提供类型安全的数据操作
- [[logger]] - LLM 调用日志记录服务

## 关系图谱

### 依赖关系
```
KagamiBot
├── Config → ConfigSystem
├── LlmClientManager → LlmClient[] → ApiKeyManager
│                   → logger → DatabaseLayer
└── SessionManager → ConnectionManager
    └── Session → MessageHandler → LlmClientManager
                                 → ContextManager → PromptTemplateManager
```

### 消息流
```
napcat群消息 → ConnectionManager → SessionManager → Session → MessageHandler
                                                             ↓
                                              ContextManager → LlmClientManager → LlmClient[] → 回复
                                                             ↓
                                                    PromptTemplateManager
```

## 核心特性

- **分层架构**：职责分离，模块化设计
- **统一处理**：简化的消息处理架构，专注流程控制
- **上下文管理**：独立的消息历史管理和LLM数据准备模块
- **模型降级**：支持多模型按优先级降级，提高可用性
- **思考链**：LLM 支持结构化的思考-回复流程
- **模板化提示词**：基于 Handlebars 的动态 prompt 生成系统
- **多提供商支持**：支持 OpenAI、Gemini 等多个 LLM 提供商，自动模型选择
- **多 API Key**：负载均衡和高可用性支持
- **回复引用**：智能决策何时使用 QQ 回复功能
- **配置驱动**：通过 YAML 文件灵活配置所有参数
- **调用日志**：完整记录 LLM 调用历史，支持问题排查和分析

## 技术栈

### QQ 机器人技术栈
- **运行时**：Node.js + TypeScript
- **QQ 集成**：node-napcat-ts
- **LLM 集成**：OpenAI API
- **模板引擎**：Handlebars
- **数据存储**：PostgreSQL + Prisma ORM
- **配置**：YAML 配置文件
- **构建**：TypeScript 编译器 + Prisma 生成器
- **代码质量**：ESLint

### 控制台系统技术栈
- **后端**：Go + Gin 框架 + GORM
- **前端**：React + TypeScript + Ant Design + Vite
- **部署**：Nginx 静态托管 + API 代理
- **数据库**：共享 PostgreSQL 数据库（通过 API 访问）