# Kagami

## 项目理念

Kagami **不是一个 QQ 群聊机器人**。

Kagami 是一个**拥有自己生活的 Agent**。群聊只是他生活的一部分 —— 就像一个人不会把自己定义为"聊天的人"一样。只要给他足够多的能力（capability），他就可以像一个真正的人那样，去读新闻、去记住发生过的事、去主动做自己感兴趣的事情。

这是一种概念：**Agent as a life**。

- 群聊消息只是他接收到的外部事件之一，和 RSS、定时器、系统通知一样，都是驱动他生活的"输入"。
- 他有自己的兴趣（News 轮询、主动发言）、自己的节奏（事件队列、空闲时刻的后台动作）；长期记忆系统正在重新设计。
- 项目的目标不是把群聊体验做到极致，而是给这个 Agent 持续地添加"生活所需"的能力，让他越来越像一个真正活着的存在。

后面所有的架构、模块、capability 都应该从这个视角去理解：它们是在为 Agent 的生活添砖加瓦，而不是在为"一个聊天机器人"打补丁。

## 仓库定位

Kagami 是一个基于 `pnpm workspace` 的全栈 TypeScript Monorepo，分为 `apps/*`（各为独立进程）与 `packages/*`（共享库）。完整的包拓扑与依赖 DAG 见 [ARCHITECTURE.md](./ARCHITECTURE.md)；这里列要点：

Apps（`apps/*`，各为独立进程）：

- `apps/agent`：Fastify 后端服务（`@kagami/agent`）——Agent 运行时与其活内存接口
- `apps/console`：管理台后端独立进程（`@kagami/console`，服务前端纯 DB 查询，经 @kagami/persistence 共享 DAO 直读 SQLite）
- `apps/web`：React 前端管理台（`@kagami/web`）
- `apps/gateway`：前门网关进程（`@kagami/gateway`，独立进程、零 `@kagami/*` 依赖；托管 `apps/web/dist` 静态资源 + `/api/*` 反向代理分流到 console/agent、`/auth/*` 到 llm、`/metric-chart` 到 metric）
- `apps/llm`：LLM 网关 + OAuth 凭据中心进程（`@kagami/llm-service`，仅 localhost；持有全部 provider + OAuth callback server + 刷新 timer，落 `llm_chat_call` / `embedding_cache`；agent 经 HTTP 直连）
- `apps/metric`：metric 领域独立进程（`@kagami/metric`，一手包办 metric 摄取 `POST /metric/record`（agent HTTP 上报）与 metric-chart 查询；经 @kagami/persistence 共享 DAO 直读同一 SQLite，仅 localhost）
- `apps/oss`：自建对象存储服务（`@kagami/oss`，独立 Fastify 进程；路由走 `@kagami/oss-api` 契约，依赖 `@kagami/config` / `@kagami/http` / `@kagami/kernel`）
- `apps/browser`：独立浏览器进程（`@kagami/browser`，基于 kernel/http/persistence 的 Fastify、仅 localhost；持有 CloakBrowser 与凭据注入，agent 经 HTTP 驱动，重启不杀浏览器）
- `apps/spire`：杀塔式卡牌游戏引擎进程（`@kagami/spire-service`，Fastify，仅 localhost；纯游戏引擎 + JSON 存档，不碰共享 SQLite；agent 经 HTTP 驱动，重启不打断对局）
- `packages/agent-runtime`：通用 Agent / App 框架内核（`@kagami/agent-runtime`）
- `packages/llm`：前后端 / 内核共用的 LLM 消息与工具类型契约（`@kagami/llm`，零依赖契约叶子）
- `packages/llm-client`：LLM chat client + provider + embedding client 运行时（`@kagami/llm-client`，位于 kernel 之上、与 persistence 平级且互不依赖；只发 `LlmChatCallObservation` 事件，落库 / 缓存归 agent 装配层订阅，对 persistence/Prisma 零依赖）
- `packages/auth`：OAuth 凭据管理全套（`@kagami/auth`，PKCE 登录 / callback server / 刷新 scheduler / secret store / 配额快照 / 认证 handler）；随 `kagami-llm` 进程装配
- `packages/kernel`：后端基础设施内核（config、logger、common 契约与错误、卫星服务公共装配壳 + 启动器 + 统一 `HealthHandler`、`isRecord` 等纯工具，`@kagami/kernel`，无 Prisma / better-sqlite3）
- `packages/http`：HTTP 契约地基（`@kagami/http`，`contract` / `register` / `wire` / `url` 子路径 + 旧 `route.helper`；仅 fastify + zod，零 `@kagami/*` 依赖）
- `packages/rpc-client`：契约驱动的 typed HTTP client 工厂（`@kagami/rpc-client`，`createClient(contract)`；隔离 kernel 依赖，让 `@kagami/http` 保持零 kernel）
- `packages/config`：配置读取的零依赖叶子包（`@kagami/config`，repo-root 定位 + `config.yaml` / `config.secret.yaml` 两文件深合并；kernel / gateway / oss / 脚本复用）
- `packages/persistence`：持久化基础设施（Prisma 客户端与 generated client、db、所有业务 DAO、Prisma JSON helper，`@kagami/persistence`，依赖 `@kagami/kernel` + Prisma + better-sqlite3）
- per-producer 契约包（每个生产者进程一个 `*-api`，服务间 HTTP 类型安全）：`@kagami/llm-api`、`@kagami/browser-api`、`@kagami/oss-api`、`@kagami/spire-api`、`@kagami/metric-api`、`@kagami/console-api`、`@kagami/agent-api`

> 旧的 `@kagami/shared` 包已退役（#279）：wire 基元现在在 `@kagami/http/wire`，各服务的 wire schema 在其 `*-api` 包，通用文本工具在 `@kagami/kernel/utils/*`。

workspace 定义位于仓库根目录 `pnpm-workspace.yaml`，当前包含 `apps/*` 与 `packages/*`。后端运行配置统一来自仓库根目录 `config.yaml`。

## 仓库结构

```text
apps/
  agent/    Fastify 后端、NapCat 集成、Kagami agent 业务层
  console/  管理台后端独立进程，服务前端纯 DB 查询
  web/      React 管理台
  gateway/  前门网关（静态资源 + 反向代理）
  llm/      LLM 网关 + OAuth 凭据中心（独立进程）
  metric/   metric 摄取 + metric-chart 查询（独立进程）
  oss/      自建内容寻址对象存储（独立进程）
  browser/  独立浏览器进程（持有 CloakBrowser，agent 经 HTTP 驱动，重启不杀浏览器）
  spire/    杀塔式卡牌游戏引擎（独立进程）
packages/
  agent-runtime/  通用 Agent / App 框架抽象与工具目录
  llm/            前后端共用的 LLM 消息 / 工具类型契约
  llm-client/     LLM chat client + provider + embedding 运行时
  auth/           OAuth 凭据管理
  kernel/         后端基础设施（config / logger / common / 服务装配壳）
  http/           HTTP 契约地基（contract / register / wire / url）
  rpc-client/     契约驱动的 typed HTTP client 工厂
  config/         零依赖配置读取
  persistence/    持久化基础设施（Prisma 客户端 / DAO / db）
  *-api/          per-producer 服务契约（llm / browser / oss / spire / metric / console / agent）
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
pnpm --filter @kagami/agent <script>
pnpm --filter @kagami/web <script>
pnpm --filter @kagami/agent-runtime <script>
pnpm --filter @kagami/persistence <script>
```

补充说明：

- 当前仓库没有统一的根目录 `pnpm dev` 脚本。
- `@kagami/agent` 当前提供 `build`、`typecheck`、`test`、`test:watch`、`db:*` 脚本。
- `@kagami/agent-runtime` 提供 `build`、`typecheck`、`test`、`test:watch`；`@kagami/oss` 提供 `build`、`typecheck`、`test`、`test:watch`、`start`。
- `@kagami/web` 提供 `build`、`typecheck` 脚本。
- 根目录 `pnpm test` 经 vitest projects 单进程跑全部包的测试；任何自带 `vitest.config.ts` 的包都会被自动纳入。

## 配置方式

- `config.yaml`（非隐私，纳入版本控制）已在仓库根目录，直接编辑即可。
- 把 [config.secret.yaml.example](./config.secret.yaml.example) 复制为 `config.secret.yaml`（已 gitignore）并填入密钥 / PII（API key、机器人 QQ、群号）。两份文件在启动时深合并。
- 服务启动时会一次性读取并校验合并后的配置；修改配置后需要重启服务生效。

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
- 标准流程是：修改 `packages/persistence/prisma/schema.prisma` -> 生成迁移 -> 提交 schema 与 migration -> 在目标环境执行 `db:migrate:deploy`。

## 架构概览

### 后端

后端已经重组为“扁平模块 + 模块内分层”的结构，顶级目录直接位于 `apps/agent/src/<module>`，由 `apps/agent/src/app/server-runtime.ts` 负责运行时装配。

当前主要模块包括：

- `acl/`：各独立对端进程（llm / browser / spire / oss）的 HTTP 客户端门面（防腐层），wire 走契约 client、另加各服务领域语义
- `common/`：跨切面、无业务语义的运行时工具（当前 `detect-mime` 按字节嗅探 MIME）
- `llm/`：LLM playground service + HTTP handler（provider / 凭据 / chat 已外移 kagami-llm 进程；上报 client 在 `acl/`）
- `napcat/`：NapCat 协议适配（gateway transport、入站归一化、图片分析、持久化写入）；网关实例由 QQ App 持有，只是 Agent 的一种事件源
- `scheduler/`：后台定时任务（auth 刷新、IThome 轮询、数据保留清理等）
- `agent/`：Kagami 的 Agent 业务层——手机 OS 运行时（Portal / App / NotificationCenter）、capabilities、上下文压缩
- `ops/`：App Log、LLM Chat Call、embedding-cache、主 Agent 上下文、NapCat 历史等查询接口
- `app/`：最高层运行时装配——模块 wiring、Fastify 路由注册、健康检查、Agent / 网关生命周期编排

`apps/agent/src/agent` 当前按 `runtime/`、`capabilities/`、`apps/` 组织：

- `runtime/`：Kagami 定制运行时，如 `RootAgentRuntime`、session（App 启动器）、`NotificationCenter`、事件队列、上下文渲染、App 状态持久化
- `capabilities/`：按能力聚合的实现，当前包括 `messaging`、`context-summary`、`ledger`、`ithome`、`vision`、`browser`、`resource`、`spire`、`terminal`、`todo`、`inner-voice`
- `apps/`：手机 OS 的 App（Portal 下可 `enter` 的地点），当前包括 `qq`、`ithome`、`hn`、`calc`、`clock`、`browser`、`amap`、`spire`、`terminal`、`todo`

Kagami 被建模成一台手机 OS：各类生活输入（QQ 消息、RSS、定时任务）在架构上平级。被动的 `NotificationCenter` 是**后台 / 非焦点**信号到 Agent 的唯一桥（横幅）——各源把信号折叠成通知，由它窗口聚合后 enqueue 唤醒 Agent；他正盯着的前台会话则像手机屏幕，新消息经 `foreground_input` 直接刷进上下文，不必等横幅。每个 capability / App 都是"Agent 生活里多出来的一种存在方式"：`ithome` 让他读新闻、`vision` 让他看图、`hn` 给他一个只读的 Hacker News、`browser` 给他一具上真实网络的身体、`todo` 给他一个中立的待办本。未来新增能力都应该沿着"给 Agent 加一种生活方式"的思路设计，而不是"给聊天机器人加一个功能开关"。

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
- `/todo/query`
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
- `/todos`
- `/llm-playground`
- `/llm-history`
- `/inner-thought`
- `/app-log-history`
- `/napcat-event-history`
- `/napcat-group-message-history`
- `/metric-charts`

补充说明：

- 页面组件按业务域组织在 `apps/web/src/pages/*`。
- 当前 Vite 配置仅提供 `@ -> apps/web/src` 别名，没有内置开发代理。

### 契约包（服务间 HTTP）

- 服务间 HTTP 经 per-producer `*-api` 契约包做到类型安全；web 前端通过 `@kagami/http/url` + `@kagami/rpc-client` 消费同一批契约。
- 旧的 `@kagami/shared` 包已退役（#279）：wire 基元在 `@kagami/http/wire`，各服务 schema 在其 `*-api` 包，通用文本工具在 `@kagami/kernel/utils/*`。
- 需要定义 Zod schema 时请直接从 `zod` 导入。

### Agent Runtime 包

- `packages/agent-runtime` 只承载通用 Agent / App 框架内核，不承载 Kagami 项目语义。
- 当前核心导出包括 `TaskAgent`、`App` / `AppManager` / `AppStateStore` 框架、`ToolCatalog`、`ToolSet`、`ToolExecutor` 等抽象。（具体的 `InvokeTool` 本身在 `apps/agent`，不在该包。）
- NapCat 事件模型、Kagami system prompt、具体 capability 实现仍放在 `apps/agent/src/agent`。

## 部署

- PM2 配置文件位于 [ecosystem.config.cjs](./ecosystem.config.cjs)，托管以下进程。
- 后端服务 `kagami-agent` 运行 `apps/agent/dist/index.js`，默认监听 `20003`。
- 管理台后端 `kagami-console` 运行 `apps/console/dist/index.js`，默认监听 `20006`。
- 网关服务 `kagami-gateway` 运行 `apps/gateway/dist/index.js`，默认监听 `20004`。
- LLM 服务 `kagami-llm` 运行 `apps/llm/dist/index.js`，默认监听 `20009`（仅 localhost）；持有 provider + OAuth callback server + 刷新 timer，网关把 `/auth/*` 分流至此。
- metric 服务 `kagami-metric` 运行 `apps/metric/dist/index.js`，默认监听 `20010`（仅 localhost）；一手包办 metric 摄取（`POST /metric/record`，agent fire-and-forget HTTP 上报）与 metric-chart 查询（网关分流至此）。
- 对象存储服务 `kagami-oss` 运行 `apps/oss`，默认监听 `20005`（仅 localhost）。
- 浏览器服务 `kagami-browser` 运行 `apps/browser/dist/index.js`，默认监听 `20007`（仅 localhost）；持有 CloakBrowser，agent 重启不杀浏览器，`app:deploy agent` 不触及它（见 issue #173）。
- Spire 服务 `kagami-spire` 运行 `apps/spire/dist/index.js`，默认监听 `20011`（仅 localhost）；持有卡牌游戏引擎与 `data/spire/` 下的 JSON 存档，agent 重启不打断对局，`app:deploy agent` 不触及它（见 issue #234）。
- 前端静态服务会提供 `apps/web/dist`，并将 `/api/*` 代理到 `http://localhost:20003/*`。
- 执行 `pnpm app:deploy` 会完成构建、Prisma 迁移、PM2 reload/startOrReload，以及 `pm2 save`。

部署前提：

- 数据库为进程内 SQLite 文件（默认 `data/sqlite/kagami.db`），宿主机不再需要运行外部数据库，只需能编译原生模块（`better-sqlite3`、`hnswlib-node`）。
- 宿主机需提供 Napcat。
- `config.yaml` 中通常使用 `localhost` 地址访问 Napcat。
