# Kagami

Kagami 是一个基于 `pnpm` workspace 的全栈 TypeScript Monorepo，当前包含三个工作空间包：

- `apps/server`：Fastify 后端服务（`@kagami/server`）
- `apps/web`：React 前端管理台（`@kagami/web`）
- `packages/shared`：前后端共享的 Schema 与工具（`@kagami/shared`）

后端运行配置统一来自仓库根目录 `config.yaml`。

## 仓库结构

```text
apps/
  server/   Fastify 后端、Prisma、Agent 运行时
  web/      React 管理台
packages/
  shared/   前后端共享 schema / DTO / utils
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
pnpm --filter @kagami/shared <script>
```

补充说明：

- 当前仓库没有统一的根目录 `pnpm dev` 脚本。
- 当前只有 `@kagami/server` 声明了测试脚本。

## 配置方式

- 在仓库根目录提供真实的 `config.yaml`。
- 字段结构参考 [config.yaml.example](/Users/kisin/Workspace/kagami/config.yaml.example)。
- 服务启动时会一次性读取并校验 `config.yaml`；修改配置后需要重启服务生效。

关键配置分区：

- `server.databaseUrl`、`server.port`
- `server.napcat.wsUrl`、`server.napcat.reconnectMs`、`server.napcat.requestTimeoutMs`、`server.napcat.listenGroupIds`
- `server.llm.timeoutMs`
- `server.llm.codexAuth`、`server.llm.claudeCodeAuth`
- `server.llm.providers.deepseek`、`server.llm.providers.openai`、`server.llm.providers.openaiCodex`、`server.llm.providers.claudeCode`
- `server.llm.usages.agent`、`contextSummarizer`、`vision`、`webSearchAgent`
- `server.rag.embedding`、`server.rag.retrieval`
- `server.tavily.apiKey`
- `server.bot.qq`

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

后端采用事件驱动的 agent 循环架构，主要目录包括：

- `agents/main-engine/`：主 agent 循环、多群运行时管理、主系统提示词
- `agents/subagents/`：子 agent 能力，当前包含 `context-summarizer`、`rag`、`reply-sender`、`vision`、`web-search`
- `auth/`、`codex-auth/`、`claude-code-auth/`：OAuth 登录状态、回调服务与认证流程
- `bootstrap/`：运行时装配与依赖初始化入口
- `config/`：静态配置加载、运行时配置管理
- `context/`、`event/`：上下文聚合、事件抽象与处理链路
- `dao/`、`db/`、`handler/`、`llm/`、`rag/`、`service/`、`tools/`

当前主要接口分组包括：

- `/health`
- `/llm/*`
- `/codex-auth/*`
- `/claude-code-auth/*`
- Napcat 相关历史与事件接口
- App Log、Embedding Cache、LLM 调用历史等后台查询接口

### 前端

前端是一个 React 管理台，当前主要页面包括：

- `/auth/:provider`
- `/llm-playground`
- `/llm-history`
- `/embedding-cache-history`
- `/app-log-history`
- `/napcat-event-history`
- `/napcat-group-message-history`

补充说明：

- 页面组件按业务域组织在 `apps/web/src/pages/*`。
- 当前 Vite 配置仅提供 `@ -> apps/web/src` 别名，没有内置开发代理。

### Shared

- `packages/shared` 用于承载前后端共用的 schema、DTO、工具函数。
- 当前 `@kagami/shared` 入口未再导出 `z`；需要定义 Zod schema 时请直接从 `zod` 导入。

## 部署

- PM2 配置文件位于 [ecosystem.config.cjs](/Users/kisin/Workspace/kagami/ecosystem.config.cjs)。
- 后端服务 `kagami-server` 运行 `apps/server/dist/index.js`，默认监听 `20003`。
- 前端服务 `kagami-web` 运行 `scripts/web-server.mjs`，默认监听 `20004`。
- 前端静态服务会提供 `apps/web/dist`，并将 `/api/*` 代理到 `http://localhost:20003/*`。
- 执行 `pnpm app:deploy` 会完成构建、Prisma 迁移、PM2 reload/startOrReload，以及 `pm2 save`。

部署前提：

- 宿主机需提供 PostgreSQL。
- 宿主机需提供 Napcat。
- `config.yaml` 中通常使用 `localhost` 地址访问这些外部依赖。
