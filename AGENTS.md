# 指示

## 项目定位

Kagami 是一个基于 pnpm workspace 的全栈 TypeScript Monorepo，当前包含四个工作空间包：

- `apps/server`：Fastify 后端服务（`@kagami/server`）
- `apps/web`：React 前端管理台（`@kagami/web`）
- `packages/agent-runtime`：通用 Agent Runtime 内核（`@kagami/agent-runtime`）
- `packages/shared`：前后端共享的 Schema 与工具（`@kagami/shared`）

workspace 定义位于仓库根目录 `pnpm-workspace.yaml`，当前仅包含 `apps/*` 与 `packages/*`。

## 硬约束

- 除非任务明确要求，否则默认在仓库根目录执行命令。
- 数据库相关命令统一读取仓库根目录 `config.yaml` 中的 `server.databaseUrl`。
- 修改配置 schema 时，必须同步更新：
  - `apps/server/src/config/config.loader.ts`
  - `config.yaml`
  - `config.yaml.example`
- 提交前至少执行：

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm format
```

需保证全部成功。

## 常用命令

### 根目录命令

```bash
pnpm build # 按 workspace 依赖拓扑构建所有包
pnpm typecheck # 对所有包执行 TypeScript 类型检查
pnpm test # 运行声明了 test 脚本的包
pnpm lint # ESLint 检查
pnpm lint:fix # ESLint 自动修复
pnpm format # Prettier 格式检查
pnpm format:write # Prettier 自动格式化
pnpm app:deploy # build -> prisma migrate deploy -> PM2 reload/startOrReload -> pm2 save
```

### 单包命令

```bash
pnpm --filter @kagami/server <script>
pnpm --filter @kagami/web <script>
pnpm --filter @kagami/agent-runtime <script>
pnpm --filter @kagami/shared <script>
```

### 当前开发现状

- 当前仓库没有统一的根目录 `pnpm dev` 脚本。
- `apps/server` 当前提供 `build`、`typecheck`、`test`、`test:watch`、`db:*` 脚本。
- `apps/web` 当前提供 `build`、`typecheck` 脚本。
- `packages/agent-runtime` 当前提供 `build`、`typecheck` 脚本。
- `packages/shared` 当前提供 `build`、`typecheck` 脚本。
- 因此前后端联调时，需要按实际情况分别启动或补充本地开发脚本，不要假设仓库已经内置一键 dev 流程。

### 测试

```bash
pnpm test # 运行整个 Monorepo 中声明了 test 脚本的包
pnpm --filter @kagami/server test # 运行后端 Vitest
pnpm --filter @kagami/server test:watch # 以后端 watch 模式运行测试
```

补充说明：

- 当前只有 `@kagami/server` 声明了测试脚本。

## 数据库与配置

### 数据库迁移

```bash
pnpm db:migrate:dev -- --name <migration_name> # 生成迁移（脚本会自动补上 --create-only）
pnpm db:migrate:deploy # 部署/上线时应用已有迁移
pnpm db:migrate:status # 查看迁移状态
pnpm db:migrate:reset # 重置数据库（危险）
pnpm db:migrate:resolve -- --applied <migration_id> # 标记迁移已应用
```

数据库变更流程：

1. 修改 `apps/server/prisma/schema.prisma`。
2. 在仓库根目录执行 `pnpm db:migrate:dev -- --name <migration_name>`。
3. 提交 schema 变更和 `apps/server/prisma/migrations/*`。
4. 在目标环境执行 `pnpm db:migrate:deploy`，或通过 `pnpm app:deploy` 一并完成。

已有数据库接入 Prisma Migrate（基线）：

1. 如果数据库结构已与当前 schema 对齐，先执行 `pnpm db:migrate:resolve -- --applied <baseline_migration_id>`。
2. 后续再按标准流程使用 `db:migrate:dev` 和 `db:migrate:deploy`。

### 配置文件

- 后端启动时通过 `apps/server/src/config/config.loader.ts` 读取并校验仓库根目录 `config.yaml`。
- `config.yaml.example` 是示例配置；调整配置结构时要同步维护它。
- 关键配置分区包括：
  - `server.databaseUrl`、`server.port`
  - `server.agent.portalSleepMs`、`server.agent.contextCompactionThreshold`
  - `server.napcat.wsUrl`、`server.napcat.reconnectMs`、`server.napcat.requestTimeoutMs`
  - `server.napcat.listenGroupIds`、`server.napcat.startupContextRecentMessageCount`
  - `server.llm.timeoutMs`
  - `server.llm.codexAuth`、`server.llm.claudeCodeAuth`
  - `server.llm.providers.deepseek`、`server.llm.providers.openai`、`server.llm.providers.openaiCodex`、`server.llm.providers.claudeCode`
  - `server.llm.usages.agent`、`contextSummarizer`、`vision`、`webSearchAgent`
  - `server.rag.embedding`、`server.rag.retrieval`
  - `server.tavily.apiKey`
  - `server.bot.qq`、`server.bot.creator`

## 代码规范

### Prettier

- 双引号（`singleQuote: false`）
- 分号（`semi: true`）
- 缩进 2 空格（`tabWidth: 2`，`useTabs: false`）
- 行宽 100 字符
- 尾逗号（`trailingComma: "all"`）

### TypeScript

- 所有包继承 `tsconfig.base.json`，开启 `strict: true`。
- 后端与 shared 使用 `module: NodeNext`、`moduleResolution: NodeNext`。
- 前端应用使用 `moduleResolution: Bundler`。
- 前端额外开启 `noUnusedLocals` 与 `noUnusedParameters`。

路径别名现状：

- 后端 `apps/server/tsconfig.json` 为 `@kagami/shared/*` 配置了源码路径映射。
- 后端 `apps/server/tsconfig.json` 也为 `@kagami/agent-runtime` 和 `@kagami/agent-runtime/*` 配置了源码路径映射。
- 前端显式配置了 `@/* -> apps/web/src/*`。
- 不要假设前端也单独声明了 `@kagami/shared` 的源码路径别名；它当前通过 workspace 依赖使用该包。

### ESLint

- 忽略 `dist/`、`build/`、`node_modules/`、`prisma/generated/`
- 前端应用启用 `react-hooks` 和 `react-refresh` 规则

### Shared 包约定

- `packages/shared` 主要承载前后端共用的 Zod Schema、响应模型和工具函数。
- `packages/shared` 不再提供根入口 barrel；统一使用显式子路径导入，例如 `@kagami/shared/schemas/health`、`@kagami/shared/utils`。
- 当前 shared 包不会导出 `z`；如果需要直接定义 Zod schema，按现状应从 `zod` 导入。
- 新代码不要在项目内新增 re-export/barrel 文件，优先直接导入真实实现路径或包的显式子路径。

### Agent Runtime 包约定

- `packages/agent-runtime` 只承载通用 Agent Runtime 内核，不承载 Kagami 项目语义。
- 允许放入该包的内容包括：`AgentRuntime`、`TaskAgentRuntime`、`Operation`、`Tool` 抽象、`ToolCatalog`、`ToolSet`、`ToolExecutor` 等纯运行时能力。
- 不要把 NapCat 事件模型、Kagami system prompt、`RootAgentRuntime`、具体 capability 实现放入该包。
- `apps/server` 中如果需要使用这些通用能力，优先直接从 `@kagami/agent-runtime` 导入，而不是继续依赖 server 内部的兼容 re-export 路径。

## 架构概览

### 后端（`@kagami/server`）

后端当前已经重组为“扁平模块 + 模块内分层”的结构，顶级目录直接位于 `apps/server/src/<module>`，以模块 DAG 为主，而不是旧的全局 `service / handler / dao / agents` 横向分层。

当前主要模块如下（非穷举）：

- `common/`：无业务语义的公共能力与跨模块契约，当前包括 `contracts/`、`errors/`、`http/`、`runtime/`
- `config/`：配置 schema、配置加载、运行时配置管理
- `db/`：Prisma 客户端、数据库连接与事务基础设施
- `logger/`：日志 runtime、serializer、sink、日志 DAO
- `auth/`：OAuth、回调服务、secret store、usage cache、usage trend 与统一认证 HTTP 接口
- `llm/`：LLM provider、chat client、embedding、playground、相关 DAO
- `napcat/`：NapCat gateway、入站事件归一化、消息发送、NapCat 相关持久化与 HTTP 接口
- `agent/`：Kagami 的 Agent 业务层，负责 RootAgent、capabilities、NapCat 事件适配、上下文压缩、RAG 等
- `ops/`：后台查询与观测接口，例如 app log、LLM history、embedding cache、NapCat history
- `app/`：最高层运行时装配，负责模块 wiring、Fastify 路由注册、健康检查与启动上下文补水

模块内优先按垂直分层组织，常见层次包括：

- `domain/`：实体、值对象、模块内 port、纯规则
- `application/`：use case、workflow、query/command service
- `infra/`：Prisma/HTTP/外部系统适配实现
- `http/`：Fastify handler 与路由注册

补充说明：

- 不是每个模块都会把 `domain / application / infra / http` 四层补齐，是否拆层以实际复杂度为准。
- 模块之间按 DAG 依赖，一个模块可以依赖多个更底层模块，但禁止出现循环依赖。

后端代码约定：

- 构造函数统一使用对象参数风格（`{ dep1, dep2 }`）。
- 新代码优先放入所属模块内部，并优先从模块根入口或模块内分层路径导入；不要继续新增全局 `handler / service / dao / event / tools / rag` 风格目录。

Agent 相关补充约定：

- 通用 Agent Runtime 内核放在 `packages/agent-runtime`，Kagami 项目语义放在 `apps/server/src/agent`。
- `apps/server/src/agent` 当前按 `runtime / capabilities` 分层组织：
  - `runtime/`：仍留在 server 的 Kagami 定制运行时，如 `RootAgentRuntime`、session、事件队列、上下文渲染
  - `capabilities/`：按能力聚合的实现，如 `web-search`、`messaging`、`context-summary`、`rag`、`vision`
- `context-summary` 归类为 `Operation`，不是 `TaskAgent`。
- `web-search` 是标准 `TaskAgent` 能力；其对主 Agent 暴露的是 tool，私有工具跟随 task-agent 放在能力目录内。
- `Tool` 的职责是上层调用入口，不承载能力本体；业务语义应放在 capability service、task-agent 或 operation 中。
- 新实现只放在 `runtime/` 或 `capabilities/`；不要重新向 `apps/server/src/agent/agents`、`apps/server/src/agent/service`、`apps/server/src/agent/dao`、`apps/server/src/agent/tools/*` 等旧风格目录补内容。

后端当前对外接口大致分为：

- 健康检查：`/health`
- OAuth 与配额管理：`/auth/:provider/status`、`/auth/:provider/login-url`、`/auth/:provider/logout`、`/auth/:provider/refresh`、`/auth/:provider/usage-limits`、`/auth/:provider/usage-trend`
- LLM Playground：`/llm/providers`、`/llm/playground-tools`、`/llm/chat`
- Napcat 主动发送：`/napcat/group/send`
- 观测与历史查询：`/app-log/query`、`/llm-chat-call/query`、`/embedding-cache/query`、`/napcat-event/query`、`/napcat-group-message/query`

### 前端（`@kagami/web`）

前端是一个 React 管理台，使用 `react-router-dom`，当前主要页面包括：

- `/auth/:provider`：认证管理页
- `/llm-playground`：LLM Playground
- `/llm-history`：LLM 调用历史
- `/embedding-cache-history`：Embedding 缓存历史
- `/app-log-history`：应用日志历史
- `/napcat-event-history`：Napcat 事件历史
- `/napcat-group-message-history`：群消息历史

补充说明：

- 页面组件当前按业务域组织在 `apps/web/src/pages/*`。
- 布局组件位于 `apps/web/src/components/layout/*`。
- 当前 Vite 配置仅提供 `@ -> apps/web/src` 别名，没有内置开发代理。

### 共享包（`@kagami/shared`）

- 共享包用于承载前后端共用的 schema、DTO、工具函数。
- 后端接口 schema 与前端消费模型尽量优先收敛到该包，避免重复定义。

## 部署说明

### 前端代理与静态托管

- 生产环境中，PM2 托管的 Node 静态服务会提供 `apps/web/dist`，并将 `/api/*` 代理到 `http://localhost:20003/*`。
- 该静态服务还暴露 `/health`。
- 当前仓库中的 Vite 配置未内置开发代理；如需本地前后端分离调试，需要自行在 `apps/web/vite.config.ts` 中补充 `server.proxy`。

### PM2

- PM2 配置文件位于仓库根目录 `ecosystem.config.cjs`。
- 后端（`kagami-server`）：单进程 `fork` 模式运行 `apps/server/dist/index.js`，默认监听 `20003`。
- 前端（`kagami-web`）：单进程 Node 静态服务运行 `scripts/web-server.mjs`，默认监听 `20004`，并代理 `/api/*`。
- `pnpm app:deploy` 会执行构建、Prisma 迁移、PM2 reload/startOrReload，以及 `pm2 save`。
- PostgreSQL 与 Napcat 作为宿主机外部依赖运行，`config.yaml` 中通常使用 `localhost` 地址访问。
