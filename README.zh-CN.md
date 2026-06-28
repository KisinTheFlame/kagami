# Kagami

## 项目理念

Kagami **不是一个 QQ 群聊机器人**。

Kagami 是一个**拥有自己生活的 Agent**。群聊只是他生活的一部分 —— 就像一个人不会把自己定义为"聊天的人"一样。只要给他足够多的能力（capability），他就可以像一个真正的人那样，去读新闻、去记住发生过的事、去主动做自己感兴趣的事情。

这是一种概念：**Agent as a life**。

- 群聊消息只是他接收到的外部事件之一，和 RSS、定时器、系统通知一样，都是驱动他生活的"输入"。
- 他有自己的记忆（Story / RAG）、自己的兴趣（News 轮询、主动发言）、自己的节奏（事件队列、空闲时刻的后台动作）。
- 项目的目标不是把群聊体验做到极致，而是给这个 Agent 持续地添加"生活所需"的能力，让他越来越像一个真正活着的存在。

后面所有的架构、模块、capability 都应该从这个视角去理解：它们是在为 Agent 的生活添砖加瓦，而不是在为"一个聊天机器人"打补丁。

## 仓库定位

Kagami 是一个基于 `pnpm workspace` 的全栈 TypeScript Monorepo，当前包含八个工作空间包：

- `apps/server`：Fastify 后端服务（`@kagami/server`）
- `apps/console`：管理台后端独立进程（`@kagami/console`，服务前端纯 DB 查询，经 server-core 共享 DAO 直读 SQLite）
- `apps/web`：React 前端管理台（`@kagami/web`）
- `apps/oss`：自建对象存储服务（`@kagami/oss`，独立进程、零 `@kagami/*` 依赖）
- `packages/agent-runtime`：通用 Agent / App 框架内核（`@kagami/agent-runtime`）
- `packages/llm`：前后端 / 内核共用的 LLM 消息与工具类型契约（`@kagami/llm`）
- `packages/server-core`：后端共享基础设施内核（Prisma 客户端与 DAO、db、logger、config、common 契约与错误，`@kagami/server-core`）
- `packages/shared`：前后端共享的 Schema 与工具（`@kagami/shared`）

workspace 定义位于仓库根目录 `pnpm-workspace.yaml`，当前包含 `apps/*` 与 `packages/*`。后端运行配置统一来自仓库根目录 `config.yaml`。

## 仓库结构

```text
apps/
  server/   Fastify 后端、NapCat 集成、Kagami agent 业务层
  console/  管理台后端独立进程，服务前端纯 DB 查询
  web/      React 管理台
  oss/      自建内容寻址对象存储（独立进程）
packages/
  agent-runtime/  通用 Agent / App 框架抽象与工具目录
  llm/            前后端共用的 LLM 消息 / 工具类型契约
  server-core/    后端共享基础设施（Prisma 客户端 / DAO / db / logger / config / common）
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
- `@kagami/agent-runtime` 提供 `build`、`typecheck`、`test`、`test:watch`；`@kagami/oss` 提供 `build`、`typecheck`、`test`、`test:watch`、`start`。
- `@kagami/web`、`@kagami/shared` 提供 `build`、`typecheck` 脚本。
- `@kagami/server`、`@kagami/agent-runtime`、`@kagami/oss` 声明了测试脚本。

## 配置方式

- 在仓库根目录提供真实的 `config.yaml`。
- 字段结构参考 [config.yaml.example](./config.yaml.example)。
- 服务启动时会一次性读取并校验 `config.yaml`；修改配置后需要重启服务生效。

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
- 标准流程是：修改 `packages/server-core/prisma/schema.prisma` -> 生成迁移 -> 提交 schema 与 migration -> 在目标环境执行 `db:migrate:deploy`。

## 架构概览

### 后端

后端已经重组为“扁平模块 + 模块内分层”的结构，顶级目录直接位于 `apps/server/src/<module>`，由 `apps/server/src/app/server-runtime.ts` 负责运行时装配。

当前主要模块包括：

- `common/`：公共契约、错误处理、HTTP 辅助、运行时工具
- `config/`：配置 schema、配置加载与运行时配置管理
- `db/`：Prisma 客户端与数据库基础设施
- `logger/`：日志 runtime、serializer、sink、日志 DAO
- `auth/`：OAuth、回调服务、secret store、usage cache、usage trend、统一认证 HTTP 接口
- `llm/`：provider、chat client、embedding、playground、相关 DAO
- `napcat/`：NapCat 协议适配（gateway transport、入站归一化、图片分析、持久化写入）；网关实例由 QQ App 持有，只是 Agent 的一种事件源
- `metric/`：运行时指标与可视化数据接口
- `scheduler/`：后台定时任务（auth 刷新、IThome 轮询、数据保留清理等）
- `oss/`：server 侧对象存储 HTTP 客户端，把图片 PUT 进自建 `apps/oss`
- `agent/`：Kagami 的 Agent 业务层——手机 OS 运行时（Portal / App / NotificationCenter）、capabilities、上下文压缩、故事记忆
- `ops/`：App Log、LLM Chat Call、Story、主 Agent 上下文、NapCat 历史等查询接口
- `app/`：最高层运行时装配——模块 wiring、Fastify 路由注册、健康检查、Agent / Story / 网关生命周期编排

`apps/server/src/agent` 当前按 `runtime/`、`capabilities/`、`apps/` 组织：

- `runtime/`：Kagami 定制运行时，如 `RootAgentRuntime`、session（App 启动器）、`NotificationCenter`、事件队列、上下文渲染、App 状态持久化
- `capabilities/`：按能力聚合的实现，当前包括 `messaging`、`context-summary`、`story`、`ithome`、`vision`、`web-search`、`browser`、`terminal`、`todo`
- `apps/`：手机 OS 的 App（Portal 下可 `enter` 的地点），当前包括 `qq`、`ithome`、`hn`、`calc`、`clock`、`browser`、`terminal`、`todo`

Kagami 被建模成一台手机 OS：各类生活输入（QQ 消息、RSS、定时任务）在架构上平级。被动的 `NotificationCenter` 是各 App / 源到 Agent 的唯一桥——各源把信号折叠成通知，由它窗口聚合后 enqueue 唤醒 Agent。每个 capability / App 都是"Agent 生活里多出来的一种存在方式"：`ithome` 让他读新闻、`story` 让他记事与回忆、`web-search` 让他上网查资料、`vision` 让他看图、`hn` 给他一个只读的 Hacker News、`browser` 给他一具上真实网络的身体、`todo` 给他一个中立的待办本。未来新增能力都应该沿着"给 Agent 加一种生活方式"的思路设计，而不是"给聊天机器人加一个功能开关"。

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
- `/napcat/private/send`
- `/app-log/query`
- `/llm-chat-call/query`
- `/llm-chat-call/:id`
- `/napcat-event/query`
- `/napcat-group-message/query`
- `/story/query`
- `/main-agent-context/recent`
- `/main-agent-context/compact`
- `/metric-chart/*`
- `/scheduler/*`

### 前端

前端是一个 React 管理台，用于观测 Agent 的"生活状态"（他最近在想什么、做什么、看到了什么）。当前主要页面包括：

- `/main-agent-context`：主 Agent 当前上下文（默认入口）
- `/auth/:provider`
- `/control-panel`
- `/scheduler-tasks`
- `/llm-playground`
- `/llm-history`
- `/app-log-history`
- `/napcat-event-history`
- `/napcat-group-message-history`
- `/story-history`
- `/metric-charts`

补充说明：

- 页面组件按业务域组织在 `apps/web/src/pages/*`。
- 当前 Vite 配置仅提供 `@ -> apps/web/src` 别名，没有内置开发代理。

### 共享包

- `packages/shared` 用于承载前后端共用的 schema、DTO、工具函数。
- `packages/shared` 不再提供根入口 barrel；优先使用显式子路径导入。
- 当前 `@kagami/shared` 不导出 `z`；需要定义 Zod schema 时请直接从 `zod` 导入。

### Agent Runtime 包

- `packages/agent-runtime` 只承载通用 Agent / App 框架内核，不承载 Kagami 项目语义。
- 当前核心导出包括 `TaskAgent`、`Operation`、`App` / `AppManager` / `AppStateStore` 框架、`ToolCatalog`、`ToolSet`、`ToolExecutor` 等抽象。（具体的 `InvokeTool` 本身在 `apps/server`，不在该包。）
- NapCat 事件模型、Kagami system prompt、具体 capability 实现仍放在 `apps/server/src/agent`。

## 部署

- PM2 配置文件位于 [ecosystem.config.cjs](./ecosystem.config.cjs)，托管三个进程。
- 后端服务 `kagami-server` 运行 `apps/server/dist/index.js`，默认监听 `20003`。
- 前端服务 `kagami-web` 运行 `scripts/web-server.mjs`，默认监听 `20004`。
- 对象存储服务 `kagami-oss` 运行 `apps/oss`，默认监听 `20005`（仅 localhost）。
- 前端静态服务会提供 `apps/web/dist`，并将 `/api/*` 代理到 `http://localhost:20003/*`。
- 执行 `pnpm app:deploy` 会完成构建、Prisma 迁移、PM2 reload/startOrReload，以及 `pm2 save`。

部署前提：

- 数据库为进程内 SQLite 文件（默认 `data/sqlite/kagami.db`），宿主机不再需要运行外部数据库，只需能编译原生模块（`better-sqlite3`、`hnswlib-node`）。
- 宿主机需提供 Napcat。
- `config.yaml` 中通常使用 `localhost` 地址访问 Napcat。
