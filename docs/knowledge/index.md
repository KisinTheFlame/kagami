# Kagami 知识图谱

## 项目概览

Kagami 是一个基于 TypeScript 的 QQ 群聊机器人，集成 LLM 功能实现智能对话。采用分层架构设计，支持主动和被动两种消息处理策略。

## 核心架构

```
┌─────────────────┐
│   KagamiBot     │  主应用入口
└─────────────────┘
         │
         ├── Config System      配置管理
         ├── SessionManager     会话管理
         └── LlmClient          LLM 客户端
```

## 节点总览

### 核心组件
- [[kagami_bot]] - 主应用类，负责初始化和生命周期管理
- [[config_system]] - 配置系统，处理 YAML 配置文件和类型定义
- [[connection_manager]] - 统一的 napcat WebSocket 连接管理
- [[session_manager]] - 多群组会话管理和消息分发
- [[session]] - 单个群组的会话封装

### 消息处理
- [[base_message_handler]] - 消息处理抽象基类，提供 LLM 集成
- [[active_message_handler]] - 主动回复策略，集成体力值系统
- [[passive_message_handler]] - 被动回复策略，基于 @ 触发

### 支持组件
- [[llm_client]] - OpenAI API 客户端封装
- [[api_key_manager]] - 多 API Key 轮询管理
- [[energy_manager]] - 体力值系统管理
- [[prompt_template_manager]] - Handlebars 提示词模板管理系统
- [[message_data_model]] - 消息数据结构定义
- [[timezone_utils]] - 时区处理工具，提供 Asia/Shanghai 时间戳

## 关系图谱

### 依赖关系
```
KagamiBot
├── Config → ConfigSystem
├── LlmClient → ApiKeyManager
└── SessionManager → ConnectionManager
    └── Session → MessageHandler → PromptTemplateManager
        ├── ActiveMessageHandler → EnergyManager
        └── PassiveMessageHandler
```

### 消息流
```
napcat群消息 → ConnectionManager → SessionManager → Session → MessageHandler → LlmClient → 回复
```

## 核心特性

- **分层架构**：职责分离，模块化设计
- **双重策略**：主动和被动两种消息处理模式
- **思考链**：LLM 支持结构化的思考-回复流程
- **模板化提示词**：基于 Handlebars 的动态 prompt 生成系统
- **体力系统**：主动模式下的智能回复频率控制
- **多 API Key**：负载均衡和高可用性支持
- **回复引用**：智能决策何时使用 QQ 回复功能
- **配置驱动**：通过 YAML 文件灵活配置所有参数

## 技术栈

- **运行时**：Node.js + TypeScript
- **QQ 集成**：node-napcat-ts
- **LLM 集成**：OpenAI API
- **模板引擎**：Handlebars
- **配置**：YAML 配置文件
- **构建**：TypeScript 编译器
- **代码质量**：ESLint