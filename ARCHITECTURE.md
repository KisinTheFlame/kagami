# Architecture

本文档描述 Kagami 仓库的代码组织、模块依赖与关键设计决策。项目理念（Agent as a life）见 [README](./README.md)；面向 LLM agent 的协作指引见 [AGENTS.md](./AGENTS.md)。

## Workspace 拓扑

pnpm workspace 当前由 12 个包组成，依赖单向（apps → packages）：

```
apps/agent  ──→ packages/agent-runtime ──→ packages/llm
      ├────────→ packages/persistence ──→ packages/kernel ──→ packages/shared
      └────────→ packages/http
apps/console ──→ packages/persistence ──→ packages/kernel ──→ packages/shared
      └────────→ packages/http
apps/web     ──→ packages/shared
apps/oss     （独立进程，零 @kagami 依赖）
apps/browser ──→ packages/persistence / kernel / http  （独立进程，持有 CloakBrowser）
```

| 包                      | 角色                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kagami/agent`         | Fastify 后端、Agent 业务装配、NapCat 网关、Agent 活内存接口（实时上下文 / story / auth / scheduler / LLM playground / QQ 发送）                                                       |
| `@kagami/console`       | 管理台后端独立进程（Fastify），服务前端纯 DB 查询（app-log / llm-chat-call / napcat-event / napcat-group-message / metric-chart），经 @kagami/persistence 共享 DAO 直读 SQLite        |
| `@kagami/kernel`        | 后端纯净基础设施：config / logger / 后端 common 契约与错误 / `isRecord` 等纯工具（无 fastify / 无 Prisma / 无 better-sqlite3）                                                        |
| `@kagami/http`          | HTTP 路由辅助（`route.helper`，仅 fastify + zod，零 `@kagami/*` 依赖）                                                                                                                |
| `@kagami/persistence`   | 持久化基础设施：Prisma client / generated client / 所有业务 DAO / Prisma JSON helper（依赖 `@kagami/kernel`）                                                                         |
| `@kagami/web`           | React 19 + Vite 管理台                                                                                                                                                                |
| `@kagami/oss`           | 自建对象存储服务（独立进程，`node:http` + 裸 better-sqlite3，零 `@kagami/*` 依赖）                                                                                                    |
| `@kagami/browser`       | 独立浏览器进程（基于 kernel/http/persistence 的 Fastify，仅 localhost）：持有 CloakBrowser 与凭据注入，agent 经 `HttpBrowserClient` 驱动；拆成独立进程让 agent 重启不杀浏览器（#173） |
| `@kagami/agent-runtime` | 与 Kagami 项目语义无关的通用 Agent 内核（TaskAgent / BaseTaskAgent / Operation / Tool / App 框架）                                                                                    |
| `@kagami/llm`           | 前后端 / 内核共用的 LLM 消息与工具类型契约（`LlmMessage` / `LlmTool` 等）                                                                                                             |
| `@kagami/shared`        | Zod schema、DTO、前后端共用工具                                                                                                                                                       |

## 后端模块 DAG

后端采用「扁平模块 + 模块内分层」结构，顶层目录直接位于 `apps/agent/src/<module>`，模块按 DAG 单向依赖。

```
                       app                  最高层装配：Fastify 注册、模块 wiring、启动
                        │
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
       ops          agent           napcat       业务 / 能力层
        │               │               │
        └──────┬────────┴──────┬────────┘
               ↓               ↓
       llm / metric / scheduler / oss-client
               │
        auth / logger / db / config
                       │
                     common         无业务语义的公共契约 / errors / http helper / runtime utils
```

每个模块内部按需分层：

- `domain/` — 实体、值对象、模块内 port、纯规则
- `application/` — use case / service / query / command
- `infra/` — Prisma、HTTP、外部系统适配
- `http/` — Fastify handler 与路由注册

非每个模块都补全四层；以实际复杂度为准。模块之间禁止循环依赖。

### 关键模块速览

| 模块        | 职责                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `common`    | `BizError`、`toHttpErrorResponse`、路由 helper、`prisma-json` 等跨模块公共契约                           |
| `config`    | `config.yaml` 加载、Zod 校验、运行时配置管理                                                             |
| `db`        | Prisma client（better-sqlite3 adapter）、事务封装                                                        |
| `auth`      | OAuth（Claude Code / Codex 等）回调、secret store、usage cache / trend                                   |
| `llm`       | LLM provider 封装、chat client、embedding、playground、调用历史 DAO                                      |
| `napcat`    | NapCat 协议适配（gateway transport / 入站归一 / 图片分析 / 持久化写入）；网关实例由 QQ App 持有          |
| `metric`    | 运行时指标采集与可视化数据接口                                                                           |
| `scheduler` | 后台定时任务（auth 刷新、IThome 轮询、数据保留清理等）                                                   |
| `oss`       | `apps/oss` 内部的 HTTP 客户端（server 侧 `oss/oss-client.ts`），把图片 PUT 进自建对象存储                |
| `agent`     | Kagami 业务层：手机 OS 运行时（Portal / App / NotificationCenter）、capabilities、上下文压缩、Story 记忆 |
| `ops`       | 后台观测接口：app-log、llm-chat-call、embedding-cache、Story、main-agent-context、napcat history         |
| `app`       | 模块装配、Fastify 路由注册、健康检查、Agent / Story / 网关生命周期编排                                   |

### Agent 子结构（手机 OS 模型）

Kagami 不是「QQ 群聊机器人」，而是一个有自己生活的 Agent。各类输入（QQ 消息、RSS、定时任务）在架构上平级，统一进入「手机 OS」模型：

```
apps/agent/src/agent/
├── runtime/          Kagami 定制运行时
│   ├── root-agent/     RootAgentRuntime、session（退化为 App 启动器）、NotificationCenter、tools
│   ├── context/        上下文渲染、线性消息账本、DefaultAgentContext
│   ├── event/          事件队列与事件类型
│   └── app-state/      App 状态持久化的 SQLite 实现（PrismaAppStateStore）
├── capabilities/     按能力聚合的实现
│   ├── messaging/      QQ 会话模型（Conversation）、send_message、AI 味门控
│   ├── story/          长期记忆 / RAG 检索 / Story 写入
│   ├── ithome/         IThome RSS 抓取与文章阅读（能力本体）
│   ├── vision/         图片理解
│   ├── web-search/     独立子 Agent，多轮搜索结果只回传摘要
│   ├── browser/        浏览器工具（8 个）；本体 BrowserService 已拆到独立进程 `apps/browser`，经 `apps/agent/src/browser/HttpBrowserClient` 驱动（#173）
│   ├── context-summary/ 上下文压缩 Operation（唯一允许 replaceMessages 的路径）
│   ├── terminal/       终端能力本体
│   └── todo/           待办本能力本体（到点 / 每日提醒经通知中心）
└── apps/             手机 OS 的 App（Portal 下可 enter 的地点）
    ├── qq/             QQ App：收纳 NapCat 网关，自管会话 + 入站事件 + 出站发送
    ├── ithome/         IThome App：RSS 未读推送
    ├── hn/             Hacker News App（只读）
    ├── calc / clock /  小工具 App
    ├── browser/        Browser App：有头浏览器登录 + 交互式逛网站
    ├── terminal/       终端 App 壳
    └── todo/           待办本 App：自发记 / 群友托付，到点回提醒
```

通用 Agent / App 框架内核位于 `packages/agent-runtime`（含 `App` 接口、`AppManager`、`AppStateStore`、`ToolCatalog`、`ToolSet`、`ToolExecutor` 等）；具体的 `InvokeTool` 在 server 侧（`apps/agent/.../root-agent/tools/invoke.tool.ts`），Kagami 项目语义不下沉到该包。

## 前端结构

```
apps/web/src/
├── pages/
│   ├── main-agent-context/      默认入口，主 Agent 当前上下文
│   ├── auth/                    OAuth 与配额
│   ├── control-panel/           控制面板（上下文压缩等操作）
│   ├── scheduler-tasks/         后台任务面板
│   ├── llm-playground/          手工触发 LLM 调用
│   ├── llm-history/             LLM 调用历史
│   ├── app-log-history/         应用日志
│   ├── napcat-event-history/    NapCat 事件
│   ├── napcat-group-message-history/  群消息
│   ├── story-history/           Story 记忆
│   └── metric-charts/           运行时指标图表
├── components/layout/           跨页面布局（HistoryListPageLayout、MobileDetailHeader 等）
├── components/ui/               基于 shadcn 的原子组件
└── lib/                         api 客户端、query keys、工具
```

技术栈：React 19、React Router、TanStack Query 5、Tailwind 3、shadcn。组件优先用 shadcn，缺失时通过 shadcn CLI 引入。

## 数据流与生命周期

### 输入：生活输入 → NotificationCenter → 事件队列

Agent 不区分输入来源；所有外部信号都是「生活输入」。手机 OS 模型下，各 App / 源把信号折叠成通知，由被动的 `NotificationCenter` 聚合后投入共享事件队列：

```
NapCat 群/私聊 ─→ QQ App.handleNapcatEvent ─┐
IThome RSS 轮询 ─→ IThome poller            ─┼─→ NotificationCenter ─→ notification 事件
                                            │     （前沿触发 + 节流窗口）        │
                                            ┘                                    ↓
story_recall / wake 等内部事件 ───────────────────────────────→ 共享事件队列 ─→ RootAgentRuntime ─→ ReAct 循环
```

关键点：

- **NapCat 网关收纳进 QQ App**。入站事件不再进共享事件队列，而是直达 `QqApp.handleNapcatEvent`；QQ App 把消息累积进会话、向 NotificationCenter push 一个 `ChatNotificationDraft`。出站发送（工具 + 管理台 HTTP）统一走 QQ App 的出站端口。
- **NotificationCenter 是 App→Agent 的唯一桥**。它源无关，按 source 折叠 draft，窗口聚合后 enqueue 一个 `notification` 事件——这条事件既投递内容也唤醒 Agent。
- 共享事件队列只承载 `notification` / `story_recall_completed` / `wake` 等已归一的事件，不承载原始协议消息。

### App 与状态

- `RootAgentSession` 退化为 **App 启动器**：Portal 列出已注册 App，`enter(<appId>)` 切焦点、`help` 披露该 App 的子工具、`switch` 在 App 间直接切、`back-to-portal` 回桌面。
- 每个 App 自管自己的状态。需要跨重启保留的状态（如 QQ 未读红点）通过框架级 **App 状态持久化能力**（`AppStateStore` + 通用 `app_state` 表）在 `onShutdown` 存档、`onStartup` 恢复。

### 推理：稳定前缀 + 易变尾部

LLM 消息列表分三段：

1. **稳定前缀** — system prompt、工具定义、历史对话。只追加，不修改。
2. **易变尾部** — 当轮新事件、召回注入、tool result。可变但只影响最后一段。
3. **计划性重建** — 仅上下文压缩允许 `replaceMessages`，一次性把旧前缀换成更短的新前缀，作为新的稳定前缀继续生长。

对应到代码：`AgentContext` 只暴露两个消息变更入口：`appendMessages`（保留前缀）与 `replaceMessages`（明确破坏前缀）。

### 工具系统：InvokeTool 顶层壳

LLM API 暴露的顶层 tools 集合是少量结构性 / 能力级元工具（`enter` / `back-to-portal` / `switch` / `wait` / `invoke` / `search_web` / `search_memory` / `help`），从启动到关停不变，不随 App / capability 数量增长。具体 App 工具通过 `invoke(name, args)` 间接调用，并通过 `enter(<appId>)` + `help` 在运行时按需披露。

设计目的：避免新增能力让顶层 tools 列表变化、把 KV 缓存命中率降到零。详见 AGENTS.md「开发原则：KV 缓存命中率优先」。

## 持久化

- **进程内 SQLite 文件**（默认 `data/sqlite/kagami.db`）通过 Prisma ORM + `@prisma/adapter-better-sqlite3` 访问；宿主机不再需要外部 PostgreSQL。
- Story 向量记忆用**进程内 HNSW 索引（hnswlib-node）**：向量以 JSON 字符串存于 `story_memory_document.embedding`（SQLite 为唯一事实来源），索引启动时重建、派生快照落 `data/vector/`。
- App 状态走通用 `app_state` 表（appId → 不透明 JSON）。
- Schema 源文件 `packages/persistence/prisma/schema.prisma`，迁移落 `packages/persistence/prisma/migrations/`，通过 `pnpm db:migrate:dev` / `db:migrate:deploy` 管理。
- DAO 按模块内分层组织：port / 接口在 `domain/` 或模块根，Prisma 实现多放在 `infra/`（`infra/impl/`），早期代码也有 `dao/` / `dao/impl/` 的形态。
- `apps/oss` 自带独立的 `data/oss/oss.db`（裸 better-sqlite3）与分片 blob 文件，不经 Prisma。

## HTTP 接口入口

| 类别            | 路径                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 健康检查        | `/health`                                                                                                                            |
| OAuth / 配额    | `/auth/:provider/status` \| `login-url` \| `logout` \| `refresh` \| `usage-limits` \| `usage-trend`                                  |
| LLM Playground  | `/llm/providers`、`/llm/playground-tools`、`/llm/chat`                                                                               |
| NapCat 主动发送 | `/napcat/group/send`、`/napcat/private/send`                                                                                         |
| 观测查询        | `/app-log/query`、`/llm-chat-call/query`、`/llm-chat-call/:id`、`/napcat-event/query`、`/napcat-group-message/query`、`/story/query` |
| Agent / 指标    | `/main-agent-context/recent`、`/main-agent-context/compact`、`/metric-chart/*`、`/scheduler/*`                                       |

> `apps/oss` 另起独立 HTTP 服务（`POST /objects` 上传、`GET` / `HEAD` / `DELETE /objects/:key`，另有 `GET /health`），仅 localhost 监听，不经 Fastify。

## 部署

- PM2（`ecosystem.config.cjs`）托管五个进程：`kagami-agent`（Fastify，Agent 运行时 + 活内存接口，默认 20003）、`kagami-console`（管理台后端，服务前端纯 DB 查询，默认 20006）、`kagami-gateway`（`apps/gateway`，静态 + 按前缀把 `/api/*` 分流到 console/agent，默认 20004）、`kagami-oss`（对象存储，默认 20005，仅 localhost）、`kagami-browser`（`apps/browser`，持有 CloakBrowser，默认 20007，仅 localhost；`cwd` 固定仓库根，agent 重启不杀浏览器，`app:deploy agent` 不触及它，见 #173）。后端进程并发读写同一 SQLite 库靠库文件级 WAL。
- `pnpm app:deploy` 串起 build → Prisma migrate deploy → PM2 reload → `pm2 save`。
- 数据库为进程内 SQLite，宿主机无需外部数据库；**NapCat** 仍作为外部依赖运行，`config.yaml` 一般用 `localhost` 访问。
- 部署机需能编译原生模块（better-sqlite3、hnswlib-node）。

## 进一步阅读

- [README.md](./README.md) — 项目理念与使用入口
- [AGENTS.md](./AGENTS.md) — 面向 LLM agent 的协作指引（KV 缓存优先、capability 设计原则、代码规范、命令清单）
- [docs/effect-model.md](./docs/effect-model.md) — Effect 模型设计
- [CHANGELOG.md](./CHANGELOG.md) — 变更记录
- [TODOS.md](./TODOS.md) — 待办清单
