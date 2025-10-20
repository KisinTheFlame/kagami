# Kagami 知识图谱

## 项目概览

Kagami 是一个采用 **pnpm workspace monorepo** 架构的 QQ 群聊机器人系统，包含 QQ 机器人、管理控制台前后端。采用分层架构设计，集成了 LLM 能力和并发控制的统一消息处理器，并提供 Web 控制台进行监控和管理。项目使用 pnpm workspace 统一管理多个子项目的依赖和构建。

## 系统架构

### Monorepo 结构
```
Kagami Workspace
├── package.json              # 根目录配置，管理共享开发依赖
├── pnpm-workspace.yaml       # workspace 配置文件
├── pnpm-lock.yaml            # 统一的锁文件
├── .dockerignore            # Docker 构建优化
├── Makefile                 # 统一构建接口
├── docker-compose.yaml       # 多容器编排
│
├── kagami-bot/              # QQ 群聊机器人 + HTTP API (Node.js + TypeScript)
│   ├── 消息处理引擎
│   ├── LLM 集成
│   ├── 数据记录
│   └── HTTP API 服务
│       ├── LLM 日志查询 API
│       ├── CORS 中间件
│       └── RESTful 路由
│
└── kagami-console-web/      # 前端控制台 (React + TypeScript)
    ├── LLM 调用历史界面
    ├── 数据筛选和排序
    └── Ant Design 深色主题
```

### 依赖管理架构
- **根目录依赖**: TypeScript、ESLint、@types/node 等开发工具，所有子项目共享
- **子项目依赖**: 各自的运行时依赖（如 Express、React）和特定开发依赖
- **版本统一**: 共享依赖的版本在根目录统一管理，确保一致性

## 节点总览

### QQ 机器人 (kagami-bot)
- [[kagami_bot]] - 主应用类，负责初始化和生命周期管理，采用分层 bootstrap 模式
- [[config_manager]] - 配置管理器，封装配置加载和访问，支持依赖注入
- [[config_system]] - 配置系统概览（已部分被 config_manager 替代）
- [[connection_manager]] - NapcatFacade 外观层，管理 napcat WebSocket 连接
- [[session_manager]] - 多群组会话管理和消息分发，采用依赖注入
- [[session]] - 单个群组的会话封装

### HTTP API 层
- [[http_api_layer]] - HTTP API 服务层，提供 RESTful 接口用于数据查询和管理

### 控制台系统
- [[console_system]] - Web 控制台整体架构和功能
- [[message_card_component]] - LLM消息卡片展示组件

### 部署架构
- [[deployment_system]] - Docker 多容器部署系统，标准化镜像版本管理
- [[pnpm_migration]] - pnpm 包管理器迁移，提升依赖管理和构建性能

### 消息处理
- [[message_handler]] - 统一消息处理器，集成 LLM 和并发控制，采用依赖注入
- [[context_manager]] - 上下文管理器，负责消息历史管理和 LLM 数据准备，依赖注入配置和模板

### LLM 集成
- [[llm_client_manager]] - LLM 客户端管理器，负责模型降级和统一调用，采用依赖注入
- [[llm_client]] - 单个 LLM 模型的调用客户端，通过 Repository 记录日志
- [[llm_function_calling]] - LLM 工具调用系统，提供完整的 function calling 支持

### 支持组件
- [[multi_provider_config]] - 多提供商配置系统，支持灵活的模型选择
- [[api_key_manager]] - 多 API Key 轮询管理
- [[prompt_template_manager]] - Handlebars 提示词模板管理系统
- [[message_data_model]] - 消息数据结构定义
- [[timezone_utils]] - 时区处理工具，提供 Asia/Shanghai 时间戳

### 领域层
- [[domain_layer]] - 领域驱动设计核心层，封装业务领域概念和规则，包含 LlmCallLog 实体和 LlmCallStatus 类型

### 数据层
- [[database_layer]] - Database 类，Prisma ORM + PostgreSQL 数据库封装，提供 Prisma 客户端访问
- [[llm_call_log_repository]] - LLM 调用日志仓储，采用 Repository 模式封装日志持久化操作

## 关系图谱

### 依赖注入架构（分层初始化）
```
bootstrap() 函数分层创建：
1. 配置层
   └── ConfigManager

2. 基础设施层 - 数据访问
   ├── Database（基础设施层）
   └── LlmCallLogRepository（依赖: Database，使用 domain_layer 的类型）

3. 基础设施层 - 外部服务
   ├── NapcatFacade (依赖: ConfigManager)
   └── PromptTemplateManager

4. LLM 层
   └── LlmClientManager (依赖: ConfigManager, LlmCallLogRepository)
       └── LlmClient[] (依赖: LlmCallLogRepository)

5. 编排层
   └── SessionManager (依赖: ConfigManager, NapcatFacade, LlmClientManager, PromptTemplateManager)
       └── Session (依赖: NapcatFacade)
           └── MessageHandler (依赖: Session, ContextManager, LlmClientManager)
               └── ContextManager (依赖: ConfigManager, PromptTemplateManager)

6. HTTP Handler 层
   └── LlmLogsRouter (依赖: LlmCallLogRepository)

7. HTTP 服务层
   └── HttpServer (依赖: LlmLogsRouter, HttpConfig)

注：领域层（domain_layer）不依赖任何其他层，被 Repository 层和应用层使用
```

### 消息流
```
napcat群消息 → NapcatFacade → SessionManager → Session → MessageHandler
                                                           ↓
                                            ContextManager → LlmClientManager → LlmClient[]
                                                 ↓                                   ↓
                                      PromptTemplateManager              LlmCallLogRepository
                                                                          (使用 domain_layer 类型)
                                                                                     ↓
                                                                          Database.prisma()
                                                                                     ↓
                                                                                  回复
```

## 核心特性

### 架构设计
- **Monorepo 架构**：采用 pnpm workspace 管理多个子项目，统一依赖和构建
- **领域驱动设计**：引入领域层封装业务概念和规则，使用统一的业务语言
- **依赖注入架构**：采用依赖注入模式，所有组件通过构造函数接收依赖，无全局单例
- **工厂函数模式**：统一使用 `newXxx()` 工厂函数创建实例，便于测试和替换
- **分层初始化**：bootstrap 函数分 6 层初始化组件，依赖方向清晰自上而下
- **外观模式**：NapcatFacade 封装 napcat 连接复杂性，提供简洁接口
- **分层架构**：职责分离，模块化设计，包含应用层、领域层、Repository 层、基础设施层

### 消息处理和 LLM 集成
- **统一处理**：简化的消息处理架构，专注流程控制
- **上下文管理**：独立的消息历史管理和 LLM 数据准备模块
- **模型降级**：支持多模型按优先级降级，提高可用性
- **工具调用支持**：完整的 LLM Function Calling 类型系统，支持 toolChoice 模式控制（auto/required/none）
- **思考链**：LLM 支持结构化的思考-回复流程
- **模板化提示词**：基于 Handlebars 的动态 prompt 生成系统，支持命令行参数配置
- **多提供商支持**：支持 OpenAI、Gemini 等多个 LLM 提供商，自动模型选择
- **多 API Key**：负载均衡和高可用性支持
- **回复引用**：智能决策何时使用 QQ 回复功能

### 配置和数据管理
- **配置驱动**：通过 ConfigManager 统一管理配置，支持命令行参数和类型安全访问
- **调用日志**：通过 Repository 模式记录 LLM 调用历史，支持问题排查和分析
- **Repository 模式**：数据访问层采用 Repository 模式，关注点分离，便于测试和维护
- **类型安全**：使用领域类型约束业务规则，编译时检查保证正确性

### 构建和部署
- **现代化包管理**：全面采用 pnpm workspace，提升依赖安装和构建性能
- **依赖分层管理**：根目录管理共享开发工具，子项目管理各自运行时依赖
- **容器化部署**：Workspace 感知的 Docker 构建，分层缓存优化
- **构建优化**：.dockerignore 优化构建上下文，Makefile 委托构建到 pnpm
- **标准化镜像**：精确的镜像版本管理（Node.js 24、pnpm 10.18.3），确保部署一致性

## 技术栈

### 项目管理
- **包管理**：pnpm workspace（monorepo 架构）
- **版本管理**：Git + GitHub
- **构建工具**：Makefile（委托给 pnpm workspace）
- **容器编排**：Docker Compose

### QQ 机器人技术栈（kagami-bot）
- **运行时**：Node.js 24 + TypeScript 5.8.3
- **QQ 集成**：node-napcat-ts
- **LLM 集成**：OpenAI API、Google Gemini API
- **模板引擎**：Handlebars（提示词模板管理）
- **数据存储**：PostgreSQL 16 + Prisma ORM
- **配置**：YAML 配置文件，支持命令行参数
- **构建**：TypeScript 编译器 + Prisma 生成器
- **代码质量**：ESLint（根目录统一管理）
- **容器化**：Docker 多阶段构建 + Alpine Linux 3.21

### HTTP API 技术栈
- **框架**：Express.js + TypeScript
- **验证**：Zod 类型验证
- **CORS**：cors 中间件
- **数据访问**：通过 Repository 模式访问数据库
- **容器化**：与 kagami-bot 统一打包部署

### 控制台系统技术栈（kagami-console-web）
- **前端**：React 19 + TypeScript 5.8.3 + Ant Design 5 + Vite 7
- **UI 组件**：Ant Design + Ant Design Icons
- **HTTP 客户端**：Axios
- **构建工具**：Vite（快速开发和生产构建）
- **代码质量**：ESLint（根目录统一管理）
- **部署**：Nginx 1.29.1 静态托管 + API 代理
- **数据访问**：通过 HTTP API 访问 PostgreSQL 数据库
- **容器化**：Nginx Alpine 镜像，workspace 感知构建