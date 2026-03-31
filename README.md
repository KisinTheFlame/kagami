# Kagami

Kagami 是一个基于 `pnpm workspace` 的全栈 TypeScript Monorepo，当前包含四个工作空间包：

- `apps/server`：Fastify 后端服务（`@kagami/server`）
- `apps/web`：React 前端管理台（`@kagami/web`）
- `packages/agent-runtime`：通用 Agent Runtime 内核（`@kagami/agent-runtime`）
- `packages/shared`：前后端共享的 Schema 与工具（`@kagami/shared`）

workspace 定义位于仓库根目录 `pnpm-workspace.yaml`，当前包含 `apps/*` 与 `packages/*`。后端运行配置统一来自仓库根目录 `config.yaml`。

## 仓库结构

```text
apps/
  server/   Fastify 后端、NapCat 集成、Kagami agent 业务层
  web/      React 管理台
packages/
  agent-runtime/  通用 Agent Runtime 抽象与工具目录
  shared/         前后端共享 schema / DTO / utils
```

## 常用命令

在仓库根目录执行：

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:write
pnpm app:deploy
```

单包执行：

```bash
pnpm --filter @kagami/server <script>
pnpm --filter @kagami/web <script>
pnpm --filter @kagami/agent-runtime <script>
pnpm --filter @kagami/shared <script>
```

补充说明：

- 当前仓库没有统一的根目录 `pnpm dev` 脚本。
- `@kagami/server` 当前提供 `build`、`typecheck`、`test`、`test:watch`、`db:*` 脚本。
- `@kagami/web`、`@kagami/agent-runtime`、`@kagami/shared` 当前提供 `build`、`typecheck` 脚本。
- 当前只有 `@kagami/server` 声明了测试脚本。

## 配置方式

- 在仓库根目录提供真实的 `config.yaml`。
- 字段结构参考 [config.yaml.example](./config.yaml.example)。
- 服务启动时会一次性读取并校验 `config.yaml`；修改配置后需要重启服务生效。

关键配置分区：

- `server.databaseUrl`、`server.port`
- `server.agent.portalSleepMs`、`server.agent.contextCompactionThreshold`
- `server.napcat.wsUrl`、`server.napcat.reconnectMs`、`server.napcat.requestTimeoutMs`
- `server.napcat.listenGroupIds`、`server.napcat.startupContextRecentMessageCount`
- `server.llm.timeoutMs`
- `server.llm.codexAuth`、`server.llm.claudeCodeAuth`
- `server.llm.providers.deepseek`、`server.llm.providers.openai`、`server.llm.providers.openaiCodex`、`server.llm.providers.claudeCode`
- `server.llm.usages.agent`、`contextSummarizer`、`vision`、`webSearchAgent`
- `server.agent.story.memory.embedding`、`server.agent.story.memory.retrieval`
- `server.tavily.apiKey`
- `server.bot.qq`、`server.bot.creator`

配置约定：

- 数据库相关命令统一读取 `config.yaml` 中的 `server.databaseUrl`。
- 修改配置 schema 时，必须同步更新：
  - `apps/server/src/config/config.loader.ts`
  - `config.yaml`
  - `config.yaml.example`
- `server.llm.usages` 需要完整提供 `agent`、`contextSummarizer`、`vision`、`webSearchAgent` 四组尝试链路。

## 数据库迁移

在仓库根目录执行：

```bash
pnpm db:migrate:dev -- --name <migration_name>
pnpm db:migrate:deploy
pnpm db:migrate:status
pnpm db:migrate:reset
pnpm db:migrate:resolve -- --applied <migration_id>
```

说明：

- `db:migrate:dev` 会自动补上 `--create-only`，只生成迁移文件，不直接改库结构。
- 标准流程是：修改 `apps/server/prisma/schema.prisma` -> 生成迁移 -> 提交 schema 与 migration -> 在目标环境执行 `db:migrate:deploy`。

## 架构概览

### 后端

后端已经重组为“扁平模块 + 模块内分层”的结构，顶级目录直接位于 `apps/server/src/<module>`，由 `apps/server/src/app/server-runtime.ts` 负责运行时装配。

当前主要模块包括：

- `app/`：应用装配、健康检查、启动上下文补水
- `common/`：公共契约、错误处理、HTTP 辅助、运行时工具
- `config/`：配置加载与运行时配置管理
- `db/`：Prisma 客户端与数据库基础设施
- `logger/`：日志 runtime、serializer、sink、日志 DAO
- `auth/`：OAuth、回调服务、secret store、usage cache、usage trend、统一认证 HTTP 接口
- `llm/`：provider、chat client、embedding、playground、相关 DAO
- `napcat/`：NapCat gateway、消息发送、事件/群消息持久化与 HTTP 接口
- `agent/`：Kagami 项目语义的 agent runtime 与 capabilities
- `ops/`：App Log、LLM Chat Call、Story、NapCat 历史等查询接口

`apps/server/src/agent` 当前按 `runtime/` 与 `capabilities/` 组织：

- `runtime/`：Kagami 定制运行时，如 root-agent、session、context、event queue
- `capabilities/`：按能力聚合的实现，如 `messaging`、`context-summary`、`story`、`vision`、`web-search`

当前主要接口分组包括：

- `/health`
- `/auth/:provider/status`
- `/auth/:provider/login-url`
- `/auth/:provider/logout`
- `/auth/:provider/refresh`
- `/auth/:provider/usage-limits`
- `/auth/:provider/usage-trend`
- `/llm/providers`
- `/llm/playground-tools`
- `/llm/chat`
- `/napcat/group/send`
- `/app-log/query`
- `/llm-chat-call/query`
- `/napcat-event/query`
- `/napcat-group-message/query`
- `/story/query`

### 前端

前端是一个 React 管理台，当前主要页面包括：

- `/auth/:provider`
- `/llm-playground`
- `/llm-history`
- `/app-log-history`
- `/napcat-event-history`
- `/napcat-group-message-history`
- `/story-history`

补充说明：

- 页面组件按业务域组织在 `apps/web/src/pages/*`。
- 当前 Vite 配置仅提供 `@ -> apps/web/src` 别名，没有内置开发代理。

### 共享包

- `packages/shared` 用于承载前后端共用的 schema、DTO、工具函数。
- `packages/shared` 不再提供根入口 barrel；优先使用显式子路径导入。
- 当前 `@kagami/shared` 不导出 `z`；需要定义 Zod schema 时请直接从 `zod` 导入。

### Agent Runtime 包

- `packages/agent-runtime` 只承载通用 Agent Runtime 内核，不承载 Kagami 项目语义。
- 当前核心导出包括 `AgentRuntime`、`TaskAgentRuntime`、`Operation`、`ToolCatalog`、`ToolComponent` 等抽象。
- NapCat 事件模型、Kagami system prompt、具体 capability 实现仍放在 `apps/server/src/agent`。

## 部署

- PM2 配置文件位于 [ecosystem.config.cjs](./ecosystem.config.cjs)。
- 后端服务 `kagami-server` 运行 `apps/server/dist/index.js`，默认监听 `20003`。
- 前端服务 `kagami-web` 运行 `scripts/web-server.mjs`，默认监听 `20004`。
- 前端静态服务会提供 `apps/web/dist`，并将 `/api/*` 代理到 `http://localhost:20003/*`。
- 执行 `pnpm app:deploy` 会完成构建、Prisma 迁移、PM2 reload/startOrReload，以及 `pm2 save`。

部署前提：

- 宿主机需提供 PostgreSQL。
- 宿主机需提供 Napcat。
- `config.yaml` 中通常使用 `localhost` 地址访问这些外部依赖。
