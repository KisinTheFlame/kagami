# Architecture

本文档描述 Kagami 仓库的代码组织、模块依赖与关键设计决策。项目理念（Agent as a life）见 [README](./README.md)；面向 LLM agent 的协作指引见 [AGENTS.md](./AGENTS.md)。

## Workspace 拓扑

pnpm workspace 由 `apps/*`（各为独立进程）与 `packages/*` 组成，依赖单向（apps → packages）：

```
apps/agent  ──→ packages/agent-runtime ──→ packages/llm
      ├────────→ packages/persistence ──→ packages/kernel
      └────────→ packages/http + 各 *-api 契约包（llm/browser/oss/spire/metric/pixel/agent-api）
apps/console ──→ packages/persistence ──→ packages/kernel
      └────────→ packages/http + packages/console-api
apps/llm     ──→ packages/llm-client + packages/auth ──→ packages/kernel / persistence / llm-api  （独立进程，LLM + OAuth 网关）
apps/metric  ──→ packages/persistence / kernel / http / metric-api  （独立进程，metric 摄取 + 图表查询）
apps/web     ──→ packages/http(wire/url 子路径) + console-api / agent-api / llm-api / metric-api
apps/oss     ──→ packages/kernel / http  （独立进程，Fastify + @kagami/oss-api 契约）
apps/browser ──→ packages/persistence / kernel / http  （独立进程，持有 CloakBrowser）
apps/spire   ──→ packages/kernel / http / spire-api  （独立进程，杀塔式卡牌游戏引擎；不碰 persistence，存档走 JSON）
apps/pixel   ──→ packages/kernel / http / pixel-api  （独立进程，像素画渲染引擎；不碰 persistence，存档走 JSON）
apps/scheduler ──→ packages/kernel / http / scheduler-api  （独立进程，通用定时调度薄时钟；无 DB、无业务语义）
```

> `@kagami/config` 是零依赖叶子包（repo-root 定位 + 两文件合并），被 kernel / gateway / oss / 脚本复用。

| 包                          | 角色                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kagami/agent`             | Fastify 后端、Agent 业务装配、NapCat 网关、Agent 活内存接口（实时上下文 / auth / scheduler / LLM playground / QQ 发送）                                                                                                                                                                                                     |
| `@kagami/console`           | 管理台后端独立进程（Fastify），服务前端纯 DB 查询（app-log / llm-chat-call / inner-thought / napcat-event / napcat-group-message / todo），经 @kagami/persistence 共享 DAO 直读 SQLite                                                                                                                                      |
| `@kagami/gateway`           | 前门网关进程（独立进程，仅依赖 `@kagami/config` / `@kagami/http`）：托管 `apps/web/dist` 静态资源 + 按前缀把 `/api/*` 反代分流到 console / agent，`/auth/*` 到 llm、`/metric/query` 到 metric                                                                                                                               |
| `@kagami/llm-service`       | LLM 网关 + OAuth 凭据中心进程（`apps/llm`，仅 localhost）：持有全部 provider + OAuth callback server + 刷新 timer，落 `llm_chat_call` / `embedding_cache`；agent 经 HTTP 直连                                                                                                                                               |
| `@kagami/metric`            | metric 领域独立进程（Fastify，仅 localhost）：一手包办 metric 摄取（`POST /metric/record`，agent HTTP 上报）+ metric 图表查询（`POST /metric/query`，前端传内联聚合规格），经 @kagami/persistence 共享 DAO 直读 SQLite                                                                                                      |
| `@kagami/web`               | React 19 + Vite 管理台                                                                                                                                                                                                                                                                                                      |
| `@kagami/oss`               | 自建对象存储服务（独立进程，Fastify + 裸 better-sqlite3；路由走 `@kagami/oss-api` 契约，get/head/delete 为 raw 路由保流式管道 / fd / 安全头语义）                                                                                                                                                                           |
| `@kagami/browser`           | 独立浏览器进程（基于 kernel/http/persistence 的 Fastify，仅 localhost）：持有 CloakBrowser 与凭据注入，agent 经 `HttpBrowserClient` 驱动；拆成独立进程让 agent 重启不杀浏览器（#173）                                                                                                                                       |
| `@kagami/spire-service`     | 杀塔式卡牌游戏引擎独立进程（`apps/spire`，Fastify，仅 localhost）：纯游戏引擎 + JSON 存档 + 自动对战模拟器，不碰共享 SQLite；agent 经 `HttpSpireClient` 驱动，拆进程让 agent 重启不打断对局（#234）                                                                                                                         |
| `@kagami/pixel-service`     | 像素画渲染引擎独立进程（`apps/pixel`，Fastify，仅 localhost）：画布算子 + pngjs 出 PNG + JSON 存档，不碰共享 SQLite；agent 经 `HttpPixelClient` 驱动，拆进程让 agent 重启不丢画布（#365）                                                                                                                                   |
| `@kagami/scheduler-service` | 通用定时调度独立进程（`apps/scheduler`，Fastify，仅 localhost）：不认识具体业务的 cron/interval 薄时钟——使用方经 `SchedulerClient` 注册"名字+周期+补偿策略"，到点经 SSE 推 tick 回去；无 DB、纯内存派生态（tick 是派生事实，断连按 misfire 合并、不做持久回放）。业务逻辑（ithome/todo/data-retention）全留在 agent（#428） |
| `@kagami/agent-runtime`     | 与 Kagami 项目语义无关的通用 Agent 内核（TaskAgent / BaseTaskAgent / Tool / App 框架）                                                                                                                                                                                                                                      |
| `@kagami/llm`               | 前后端 / 内核共用的 LLM 消息与工具类型契约（`LlmMessage` / `LlmTool` 等，零依赖契约叶子）                                                                                                                                                                                                                                   |
| `@kagami/llm-client`        | LLM chat client + provider + embedding client 运行时；只发 observation 事件，落库 / 缓存归 agent 装配层，对 persistence 零依赖                                                                                                                                                                                              |
| `@kagami/auth`              | OAuth 凭据管理全套（PKCE 登录 / callback server / 刷新 scheduler / secret store / 配额快照 / 认证 handler）；随 `kagami-llm` 进程装配                                                                                                                                                                                       |
| `@kagami/kernel`            | 后端基础设施：config / logger / 后端 common 契约与错误 / 卫星服务公共装配壳与启动器（`http/service-app` + `http/service-runner` + 统一 `HealthHandler`，issue #274）/ `isRecord`、`utils/{text,time,assert}` 等纯工具（无 Prisma / 无 better-sqlite3）                                                                      |
| `@kagami/http`              | HTTP 契约地基：`contract`（`RouteContract`/`defineJsonRoute`，类型层面浏览器安全）+ `register`（`registerJsonRoute` 等服务端注册原语）+ `wire`（分页/JsonValue/health 基元）+ `url`（`contractUrl`/`interpolatePath`，web 前端用）+ 旧 `route.helper`（仅剩 health 路由使用）；仅 fastify + zod，零 `@kagami/*` 依赖        |
| `@kagami/rpc-client`        | 契约驱动的 typed HTTP client 工厂（`createClient(contract)`）：消费端从生产者契约派生类型 + 对响应 `output.parse`；kernel 依赖（重建 BizError）隔离在此，让 `@kagami/http` 保持零 kernel                                                                                                                                    |
| `@kagami/llm-api`           | kagami-llm 进程契约包（per-producer `xxx-api`，#230/#279）：内部 RPC providers/chat/chat-direct/embed（后三条信封级）+ `/auth/*` 六条 OAuth 管理路由（web 消费）+ LLM 负载核心 schema（`llm-chat`）与 auth 系 schema                                                                                                        |
| `@kagami/spire-api`         | kagami-spire 进程契约包：run/start、run/action、run/state、reference 四条逐字段 schema；服务端 state-view 与 agent 门面类型同源派生（#279 PR2）                                                                                                                                                                             |
| `@kagami/metric-api`        | kagami-metric 进程契约包：`/metric/record` 摄取 + `/metric/query` 图表查询（web 消费，内联聚合规格无 CRUD）；agent 侧上报客户端见 `@kagami/metric-client`                                                                                                                                                                   |
| `@kagami/metric-client`     | metric 上报 SDK（消费端）：基于 metric-api 契约在 `createClient` 之上包一层 fire-and-forget（永不抛、失败只记日志、2s 超时）；`HttpMetricClient` / `NOOP_METRIC_CLIENT`，agent 装配                                                                                                                                         |
| `@kagami/scheduler-api`     | kagami-scheduler 进程契约包（#428）：register（幂等 replace-all）/ status 两条 JSON 路由 + SSE tick 事件（`SchedulerTickEvent` / `SCHEDULER_TICKS_SSE_PATH`）+ 通用调度 schema（`ScheduleSpec` / misfire 策略 / TaskRun）；零业务语义                                                                                       |
| `@kagami/scheduler-client`  | 定时调度使用方 SDK（消费端，#428）：注册任务集 + 长连 SSE tick 流自动派发到本地 handler + 本地 per-task 并发锁 + occurrence 去重 + `listStatus()` 合并 tick 侧与本地执行历史；`SchedulerClient`，agent 装配                                                                                                                 |
| `@kagami/console-api`       | kagami-console 进程契约包：app-log / llm-chat-call（含 `:id` 路径参数）/ inner-thought / napcat-event / napcat-group-message / todo 七条管理台查询路由（web 消费）                                                                                                                                                          |
| `@kagami/agent-api`         | kagami-agent 进程面向管理台的契约包：napcat 发送 ×2、playground ×3、scheduler ×2（`:name` 路径参数）、main-agent-context ×2（web 消费）                                                                                                                                                                                     |
| `@kagami/browser-api`       | kagami-browser 进程对 agent 暴露的动作 RPC 契约包（9 条 JSON 路由；screenshot 以 base64 over JSON，agent 门面解回 Buffer；错误通道独立于 BizErrorWire）                                                                                                                                                                     |
| `@kagami/oss-api`           | kagami-oss 进程的对象存储 RPC 契约包（binary 两形状：putObject 信封路由共享 `{ key }` schema；get/head/delete raw 路由只钉路径与参数，字节流不进 Zod）                                                                                                                                                                      |
| `@kagami/pixel-api`         | kagami-pixel 进程的像素画 RPC 契约包（#365）：8 条 JSON 绘图路由回 `CanvasResponse`（领域拒绝走 `{ok:false}`）+ render binary-raw 路由回 PNG 字节；含 DB16 命名调色板（name/glyph/hex）共享常量                                                                                                                             |
| `@kagami/persistence`       | 持久化基础设施：Prisma client / generated client / 所有业务 DAO / Prisma JSON helper（依赖 `@kagami/kernel`）                                                                                                                                                                                                               |
| `@kagami/config`            | 零依赖叶子包：repo-root 定位 + `config.yaml` / `config.secret.yaml` 两文件深合并，被 kernel / gateway / oss / 脚本复用                                                                                                                                                                                                      |

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

| 模块        | 职责                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `acl`       | 各独立对端进程（llm / browser / spire / oss）的 HTTP 客户端门面（防腐层）：wire 走契约 `createClient` / `createBinaryClient`，另加各服务领域语义（重试匹配 / 版本幂等 / 错误归一 / maxBytes 等） |
| `common`    | 跨切面、无业务语义的运行时工具（当前：`detect-mime` 按字节嗅探 MIME）                                                                                                                            |
| `llm`       | LLM playground service + HTTP handler（provider / 凭据 / chat 已外移 kagami-llm 进程；上报 client 在 `acl/`）                                                                                    |
| `napcat`    | NapCat 协议适配（gateway transport / 入站归一 / 图片分析 / 持久化写入）；网关实例由 QQ App 持有                                                                                                  |
| `scheduler` | 后台定时任务（auth 刷新、IThome 轮询、数据保留清理等）                                                                                                                                           |
| `agent`     | Kagami 业务层：手机 OS 运行时（Portal / App / NotificationCenter）、capabilities、上下文压缩                                                                                                     |
| `ops`       | 后台观测接口：app-log、llm-chat-call、inner-thought、embedding-cache、main-agent-context、napcat history                                                                                         |
| `app`       | 模块装配、Fastify 路由注册、健康检查、Agent / 网关生命周期编排                                                                                                                                   |

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
│   ├── ledger/         root agent 消息账本（只写不读，留作将来记忆系统的原始素材）
│   ├── ithome/         IThome RSS 抓取与文章阅读（能力本体）
│   ├── vision/         图片理解
│   ├── browser/        浏览器工具（8 个）；本体 BrowserService 已拆到独立进程 `apps/browser`，经 `apps/agent/src/acl/browser-client.ts` 驱动（#173）
│   ├── context-summary/ 上下文压缩 task agent（唯一允许 replaceMessages 的路径）
│   ├── resource/       资源工具（read_resource / upload_resource / download_resource，OSS 对象进出上下文）
│   ├── spire/          尖塔卡牌游戏工具本体（look / play_card / choose 等，经 SpireClient 打独立进程）
│   ├── terminal/       终端能力本体
│   ├── todo/           待办本能力本体（到点提醒经通知中心）
│   └── inner-voice/    摸鱼判定（确定性）+ 内心独白 TaskAgent（镜像装配命中 KV cache）：空闲时以小镜口吻注入 `<inner_thought>`（#265 / #410）
└── apps/             手机 OS 的 App（Portal 下可 enter 的地点）
    ├── qq/             QQ App：收纳 NapCat 网关，自管会话 + 入站事件 + 出站发送
    ├── ithome/         IThome App：RSS 未读推送
    ├── hn/             Hacker News App（只读）
    ├── calc / clock /  小工具 App
    ├── browser/        Browser App：有头浏览器登录 + 交互式逛网站
    ├── amap/           高德地图 App：地点搜索 / 路线规划 / 静态地图出图（#182）
    ├── spire/          Spire App：杀塔式卡牌游戏薄壳，经 HttpSpireClient 打到独立 apps/spire 进程（#234）
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
│   ├── todos/                   待办（只读，含历史）
│   ├── llm-playground/          手工触发 LLM 调用
│   ├── llm-history/             LLM 调用历史
│   ├── inner-thought/           内心念头（inner-voice 每次触发的念头流水，#359）
│   ├── app-log-history/         应用日志
│   ├── napcat-event-history/    NapCat 事件
│   └── napcat-group-message-history/  群消息
├── components/metric/           可复用 metric 图表组件（<MetricChart> 三层，就近嵌入各页，#444）
├── components/layout/           跨页面布局（HistoryListPageLayout、MobileDetailHeader 等）
├── components/ui/               原子组件（保留 Radix 无样式行为基元，外观项目自定义，见 DESIGN.md）
└── lib/                         api 客户端、query keys、工具
```

技术栈：React 19、React Router、TanStack Query 5、Tailwind 3。已弃用 shadcn 的有样式组件层与默认 slate 主题，只保留 `@radix-ui/*` 无样式行为基元（管焦点 / 键盘可访问性），其余 class 体系与组件外观全部自定义（见 [DESIGN.md](./DESIGN.md)）。

## 数据流与生命周期

### 输入：生活输入 → 事件队列（横幅经 NotificationCenter，屏幕经 foreground_input）

Agent 不区分输入来源；所有外部信号都是「生活输入」。手机 OS 模型下，后台 / 非焦点信号折叠成通知（「横幅」），由被动的 `NotificationCenter` 聚合后投入共享事件队列；前台当前会话的实时输入走 `foreground_input` 直达（「屏幕」）：

```
NapCat 群/私聊 ─→ QQ App.handleNapcatEvent ─┬─（后台/非当前会话）→ NotificationCenter ─→ notification 事件
IThome RSS 轮询 ─→ IThome poller  ──────────┘   （前沿触发 + 节流窗口）                        │
                                                                                              ↓
QQ 前台当前会话新消息 ─→ 敲门 foreground_input 事件（不带内容，drain 时向当前 App 现拉）→ 共享事件队列 ─→ RootAgentRuntime ─→ ReAct 循环
async_tool_result / wake 等内部事件 ────────────────────────────────────────────────────→ ↑
```

关键点：

- **NapCat 网关收纳进 QQ App**。入站事件不再进共享事件队列，而是直达 `QqApp.handleNapcatEvent`；QQ App 按「屏幕 vs 横幅」分流：前台且属当前会话的消息入缓冲并敲门（实时路径），其余累积进会话、向 NotificationCenter push 一个 `ChatNotificationDraft`。出站发送（工具 + 管理台 HTTP）统一走 QQ App 的出站端口。
- **NotificationCenter 是后台 / 非焦点信号到 Agent 的唯一桥（横幅）**。它源无关，按 source 折叠 draft，窗口聚合后 enqueue 一个 `notification` 事件——这条事件既投递内容也唤醒 Agent。前台当前会话经 `foreground_input` 直达上下文尾部（屏幕），不经 center；焦点漂移（退后台 / 切会话 / reset）时未投递的未读退化回通知路径，绝不静默丢。
- 共享事件队列只承载 `notification` / `async_tool_result_completed` / `foreground_input` / `wake` / `inner_thought` 等已归一的事件，不承载原始协议消息。`foreground_input` 是不带内容的敲门：内容在 drain 时由 session 向当前前台 App（实现 `ForegroundInputSource` 的）现拉，永不 stale。`inner_thought` 由 inner-voice 摸鱼判定触发（#265），装配成 `<inner_thought>` 追加尾部并唤醒一轮。

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

LLM API 暴露的顶层 tools 集合是少量结构性 / 能力级元工具（`switch` / `wait` / `invoke` / `help` 等），从启动到关停不变，不随 App / capability 数量增长。具体 App 工具通过 `invoke(name, args)` 间接调用，并通过 `switch(<appId>)` + `help` 在运行时按需披露。App 名单（id + 名称）每轮由主循环渲染进 system prompt，让 Agent 天然知道有哪些 App 可切；靠「App 集合进程内不可变（register 集中在启动期）」这条不变量保证相同入参每轮字节恒定、前缀不漂移，名单只在增删 App 时变、必然伴随重启。

设计目的：避免新增能力让顶层 tools 列表变化、把 KV 缓存命中率降到零。详见 AGENTS.md「开发原则：KV 缓存命中率优先」。

## 持久化

- **进程内 SQLite 文件**（默认 `data/sqlite/kagami.db`）通过 Prisma ORM + `@prisma/adapter-better-sqlite3` 访问；宿主机不再需要外部 PostgreSQL。
- App 状态走通用 `app_state` 表（appId → 不透明 JSON）。
- Schema 源文件 `packages/persistence/prisma/schema.prisma`，迁移落 `packages/persistence/prisma/migrations/`，通过 `pnpm db:migrate:dev` / `db:migrate:deploy` 管理。
- DAO 按模块内分层组织：port / 接口在 `domain/` 或模块根，Prisma 实现多放在 `infra/`（`infra/impl/`），早期代码也有 `dao/` / `dao/impl/` 的形态。
- `apps/oss` 自带独立的 `data/oss/oss.db`（裸 better-sqlite3）与分片 blob 文件，不经 Prisma。

## HTTP 接口入口

| 类别            | 路径                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 健康检查        | `/health`                                                                                                                                                   |
| OAuth / 配额    | `/auth/:provider/status` \| `login-url` \| `logout` \| `refresh` \| `usage-limits` \| `usage-trend`                                                         |
| LLM Playground  | `/llm/providers`、`/llm/playground-tools`、`/llm/chat`                                                                                                      |
| NapCat 主动发送 | `/napcat/group/send`、`/napcat/private/send`                                                                                                                |
| 观测查询        | `/app-log/query`、`/llm-chat-call/query`、`/llm-chat-call/:id`、`/inner-thought/query`、`/napcat-event/query`、`/napcat-group-message/query`、`/todo/query` |
| Agent / 指标    | `/main-agent-context/recent`、`/main-agent-context/compact`、`/metric/query`、`/scheduler/*`                                                                |

> `apps/oss` 另起独立 HTTP 服务（`POST /objects` 上传、`GET` / `HEAD` / `DELETE /objects/:key`，另有 `GET /health`），仅 localhost 监听，Fastify + `@kagami/oss-api` 契约（putObject 信封路由 / 其余 raw 路由，上行字节流透传不缓冲）。

## 部署

- PM2（`ecosystem.config.cjs`）托管以下进程：`kagami-agent`（Fastify，Agent 运行时 + 活内存接口，默认 20003）、`kagami-console`（管理台后端，服务前端纯 DB 查询，默认 20006）、`kagami-gateway`（`apps/gateway`，静态 + 按前缀把 `/api/*` 分流到 console/agent、`/auth/*` 到 llm、`/metric/query` 到 metric，默认 20004）、`kagami-oss`（对象存储，默认 20005，仅 localhost）、`kagami-browser`（`apps/browser`，持有 CloakBrowser，默认 20007，仅 localhost；`cwd` 固定仓库根，agent 重启不杀浏览器，`app:deploy agent` 不触及它，见 #173）、`kagami-llm`（`apps/llm`，LLM + OAuth 凭据网关，默认 20009，仅 localhost；持有 provider + callback server + 刷新 timer，`app:deploy agent` 不触及它，有 DB 迁移时 `deploy.sh` 会连它一并停服再迁）、`kagami-metric`（`apps/metric`，metric 摄取 + metric 图表查询，默认 20010，仅 localhost；agent fire-and-forget HTTP 上报，有 DB 迁移时一并停服再迁）、`kagami-spire`（`apps/spire`，杀塔式卡牌游戏引擎，默认 20011，仅 localhost；`cwd` 固定仓库根让存档 `data/spire/` 落仓库根，`app:deploy agent` 不触及它，agent 重启不打断对局，见 #234）、`kagami-pixel`（`apps/pixel`，像素画渲染引擎，默认 20012，仅 localhost；`cwd` 固定仓库根让存档 `data/pixel/` 落仓库根，`app:deploy agent` 不触及它，agent 重启不丢画布，见 #365）、`kagami-napcat`（`apps/napcat`，NapCat 接入独立进程，默认 20013，仅 localhost；持有到 NapCat 的 WS 长连接 + 出站 RPC + 入站 SSE + vision/OSS 存档 + napcat 表落库，`cwd` 固定仓库根，`app:deploy agent` 不触及它，agent 重启不打断 QQ 连接，见 #347）、`kagami-scheduler`（`apps/scheduler`，通用定时调度薄时钟，默认 20014，仅 localhost；无 DB、纯内存派生态，agent 经 `SchedulerClient` 注册 + SSE 收 tick，`app:deploy agent` 不触及它，agent 重启不打断计时节奏，见 #428）。后端进程并发读写同一 SQLite 库靠库文件级 WAL（`apps/spire` / `apps/pixel` / `apps/scheduler` 不入库，前二者存档走 JSON、scheduler 无持久化）。
- 卫星进程（console / oss / browser / llm / metric / spire / pixel / napcat / scheduler）统一经 `@kagami/kernel` 的 `runService` 启动（issue #274）：全局 `uncaughtException` / `unhandledRejection` 兜底（记日志后 exit(1) 交 PM2 重启）、信号驱动优雅关停 + 10s 强退兜底、绑定地址一律 `127.0.0.1`（绑定是代码级安全决策；config 的 `services.*.host` 语义是 reachable host）。gateway 是唯一绑 `0.0.0.0` 的前门（裸 node:http，自带同款兜底）。所有进程的 `GET /health` 统一为 shared 的 `{ status: "ok", timestamp }` 形状。
- `pnpm app:deploy` 串起 build → Prisma migrate deploy → PM2 reload → `pm2 save`。
- 数据库为进程内 SQLite，宿主机无需外部数据库；**NapCat** 仍作为外部依赖运行，`config.yaml` 一般用 `localhost` 访问。
- 部署机需能编译原生模块（better-sqlite3、hnswlib-node）。

## 进一步阅读

- [README.md](./README.md) — 项目理念与使用入口
- [AGENTS.md](./AGENTS.md) — 面向 LLM agent 的操作手册（KV 缓存优先、硬约束、命令、部署红线）
- [docs/configuration.md](./docs/configuration.md) — 配置分区、SQLite 布局、Prisma 迁移
- [TODOS.md](./TODOS.md) — 待办清单
