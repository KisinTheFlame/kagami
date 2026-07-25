# TODOs

待办事项清单。按模块 / 主题分组，组内按优先级 P0 → P3 排序。完成的项直接删除。

**优先级语义**：

| 级别 | 含义                        |
| ---- | --------------------------- |
| P0   | 阻塞性问题，必须立刻处理    |
| P1   | 重要但不阻塞，应当尽快安排  |
| P2   | 改进项，时间允许时处理      |
| P3   | 想法 / 长期项，可能永远不做 |

**条目格式**：

```markdown
### <一句话标题>

- **Priority:** P{0-3}
- **Status:** open | in-progress
- **Context:** 为什么这件事值得做、依赖、约束（可选）
- **Notes:** 链接、相关文件、相关 issue/PR（可选）
```

---

## architecture

### usage→provider 策略下沉到 agent，kagami-llm 只留 provider/凭据/机械执行

- **Priority:** P2
- **Status:** open
- **Context:** usage→(provider, model, attempts) 的解析 + 多 attempt 重试循环整个跑在 **kagami-llm 内部**的 `@kagami/llm-client`（`client.ts:137` `requireUsageConfig`），`usages.{...}` 还是 config 里逐字段硬编码的对象。抽象泄漏：号称"通用 LLM + OAuth 网关"的服务替调用方保管 provider 策略。**原先记录的具体代价已被 #555 消解**：当时 `innerVoice` / `contextSummarizer` / `todoSuggestionAgent` 各占一个私有 usage，新增一个就得连带重启 kagami-llm（否则报 `LlmClient usage is not configured`）；#555 后 fork 型 task agent 一律复用 `usage: "agent"`（这也是命中 prompt cache 的硬要求），调用归因改走 `scene` 自由字段，usage 集合收敛为 `agent` / `vision` 两个稳定值，那条 bug 路径已不复存在。**剩下的仍是边界问题**：这两个 usage 名依旧是 agent 的词汇，多 Agent 未来网关会重新堆积各家私有 usage。优先级因此从"踩过坑"降为"纯架构整洁"。
- **Notes:** 正确边界 = kagami-llm 拥有 provider 凭据/OAuth + "拿 provider X + model Y 打这一发"的机械执行 + 落库 observation（词汇是 provider/model，通用稳定）；agent 拥有 usage→provider 策略表 + attempt 重试循环。**机制已现成**：`chatDirect(providerId, model)` 就是"caller 定 provider、网关只执行"（`@kagami/llm-client` 已暴露该原语）。重构 = 把 `usages` 配置从共享 llm 段（`config.loader.ts:365`）挪到 agent 段、把 attempt-loop 从 `@kagami/llm-client` 搬到 agent 侧解析器、重写 `HttpLlmClient.chat`（`http-llm-client.ts:47`）为"本地解析 usage→provider→chatDirect"。收益：加 usage 永不碰/不重启 llm，那个 failed bug 结构性消失，边界对上"通用网关"定位。走 spec 流水线单开 issue，别 inline。

### 治理对外部时间/外部条件的直接依赖，核心逻辑改为可注入的状态机

- **Priority:** P2
- **Status:** open
- **Context:** 代码里直接使用 `setTimeout` 这类依赖外部时间（或其他外部条件）的写法散落在业务逻辑中，导致核心逻辑难以单测、行为不确定、时序耦合。目标是把核心业务逻辑写成一个**无外部依赖（或纯依赖注入）的状态机**：把时间、随机、IO 等外部因素从核心逻辑里剥离，通过输入事件 / 注入的时钟驱动状态转移，副作用以"指令"形式回传给外层执行。最典型的参照实现是 etcd 的 raft —— 核心状态机纯函数化、`tick` 驱动、外部只负责把网络/磁盘/时钟喂进来并执行它产出的动作。
- **Notes:** 先盘点现有 `setTimeout` / `Date.now()` / 直接读时钟的调用点（事件队列、wait 工具、通知批窗、调度器、重连退避等），评估哪些属于"核心逻辑"应当被状态机化，哪些是外层适配可以保留。改造时注意不要破坏 KV 缓存前缀稳定性原则。

### 工具 description / result 文案的收口（进上下文文本收口的第二批）

- **Priority:** P3
- **Status:** open
- **Context:** "进上下文散文收口到 static/ 模板"第一批只收了 prose（factory 手拼壳 + 通知 draft），**显式排除了两类也会进上下文的文本**，留待以后：①工具 description（如 `send-message.tool.ts:27`）——它是稳定前缀的一部分、绑 param schema、属渐进式披露的垂直切片，收进中央会打破 App 自持工具文档的内聚；②工具 result 里的 error/status note（如 `send-message.tool.ts:90-172`）——进易变尾部非前缀、与控制流交织、是给小镜看的内部状态字。这两类分散在几十个 `.tool.ts` 里，改一处语气仍要满仓库找。
- **Notes:** 以后若真要动，先想清楚代价：description 搬中央 = 破坏垂直切片 + 每加工具改中央；error note 搬常量层 = 每工具多一层 `MESSAGES.X` 间接引用、可读性下降。当前判断是收益 < 代价，故本轮不收。参照第一批的原则：TS 只算 view-model、文案走模板；但 description 与前缀/schema 强绑，未必适用同一机制，需单独设计。

### App 首次进入自动吐 help 后，entered-set 是否需要持久化进 snapshot

- **Priority:** P3
- **Status:** open
- **Context:** #223 让每个 App 在一桶上下文里首次进入时自动追加一次 `<app_help>`，“已进入过哪些 App” 的 entered-set 目前是纯内存态（不进 snapshot，与 `currentApp` 生命周期一致，方案 A）。副作用：进程重启 / 发版后，在已有持久化上下文之上，首进各 App 会各重吐一次 help，多次 deploy 会逐桶累积。#223 落地时选了“接受这一有界重复”——最简、与 `currentApp` 一致，且压缩本来就会重注入、量级相当。长期更干净的做法是把 entered-set 一并存进 root-agent snapshot（方案 B），消除重启重复；但这给“纯内存焦点态”开了持久化口子、和 `currentApp` 不一致，复杂度换边际收益，故暂缓。
- **Notes:** 触发点：codex review #223 方案时提出。相关文件 `apps/agent/src/agent/runtime/root-agent/session/root-agent-session.ts`（`enteredApps` + `markRestored`）、snapshot 持久化在同模块 `persistence/`。真要做时先评估：entered-set 进 snapshot 是否连带要求 `currentApp` 也持久化，否则焦点态半持久化会语义割裂。

---

## scheduler

### `ithome_article` / `ithome_feed_cursor` 的清理策略

- **Priority:** P1
- **Status:** open
- **Context:** 当前 `apps/agent/src/agent/capabilities/data-retention/retention-tasks.ts` 显式把 `ithome_article` 与 `ithome_feed_cursor` 排除在每日清理之外（[retention-tasks.ts:44](apps/agent/src/agent/capabilities/data-retention/retention-tasks.ts:44)）。RSS 文章既不像日志那样安全按时间清掉，也不像 `ledger` 消息账本那样要整份留作原始素材 —— 需要单独想清楚保留窗口、与 Agent 召回路径的关系、以及 `ithome_feed_cursor` 在重置后如何避免重新拉取已读旧文章。
- **Notes:** 决策前不要简单地把它加进 `RETENTION_TASKS`。

---

## napcat

### 合并转发里小镜看不到自己的消息（NapCat / NTQQ 上游限制）

- **Priority:** P3
- **Status:** open
- **Context:** 在「和小镜的私聊」里选中**包含小镜自己发出的消息**生成合并转发、再发给小镜，小镜用 `view_forward` 展开时**看不到其中自己（本账号 `714457117`）的那部分消息**，只看得到对方的消息。已 live 实测确诊：转发 `7656887019929762382` 实际含 4 条（闻震 2 条 + 小镜 2 条），但 NapCat 经 `get_msg` 与 `get_forward_msg` **都只返回 2 条对方消息，小镜自己的 2 条彻底不在返回里**（无隐藏节点、无 `user_id=0` 占位）。根因在 NapCat / NTQQ 数据层：按 `resId` 重建合并转发时，本账号自己发出的消息在进入 NapCat 解析**之前**就已不存在——NapCat 源码 `parseMultiMessageContent` / `parseMessageV2` 并不过滤 self（self 消息只会被打 `post_type: message_sent` 照常返回），所以不是 NapCat 故意过滤，而是上游 NTQQ 没把 self 节点交出来。**客户端无解**：数据从源头就没到我们手里，换任何 OneBot 接口结果一致。与我们的 `view_forward` 实现无关（[0.3.1.6] 的 node-napcat-ts 对齐、[0.3.1.10] 的 get_msg 主路径都已确认无关）。
- **Notes:** 对路的修法是**上报 NapCat**（NTQQ 重建合并转发时丢本账号自己的消息）。本地不要做脆弱的兜底拼接：缺失节点完全空白，转发段只给 `{id}` 不带条数摘要，我们既拿不到小镜消息的 message_id / 时间戳，也没有"少了几条"的信号，无法可靠还原，靠时间戳穿插猜测极易张冠李戴。相关 live 验证：forward `7656887019929762382` 实测返回 2 / 实际 4。

---

## oss

### OSS 并发/内存上限 + slowloris 防护

- **Priority:** P2
- **Status:** open
- **Context:** 流式化本身已落地（PR #201）：`apps/oss/src/http/server.ts` 的 put 直接把请求体流交给 `store.put` 边流边算 sha256 落临时文件，get 走 `pipeline(result.stream, res)`，均不整块驻留内存。**仍缺**的是并发/超时护栏：`bodyLimit` 只是单请求级，无进程级并发上限，N 个并发大上传仍可堆高内存；且未配 `server.requestTimeout`/`headersTimeout`，慢连接可 slowloris。/ship 对抗式评审（Claude + Codex 双模型一致）发现。当前仅 localhost、单一可信消费方（server），风险可控。
- **Notes:** 加进程级并发信号量（超限时排队而非全部并发），并在 Fastify server 上设 `requestTimeout`/`headersTimeout`。

### OSS 落盘 fsync 持久化

- **Priority:** P3
- **Status:** open
- **Context:** `apps/oss/src/store/object-store.ts` 的 `ensureBlobFileFromTemp` 只把流式落好的临时文件 `rename` 转正，未 fsync 文件与目录。断电/内核崩溃后可能 SQLite 事务已提交（库说有）但文件内容/目录项未落盘（文件空或丢失），`sweepOrphans` 只回收"文件在、行不在"，不修复"行在、文件没内容"。Codex 对抗式评审发现。概率低且内容可重新拉取（QQ 图片源可重取 + put 自愈），故定 P3。
- **Notes:** 修法：写完 tmp 后 fd.sync()，rename 后再 fsync 父目录。

---

## browser（Browser App 设计衍生，2026-06-27 /plan-eng-review）

### Browser App fast-follow 工具

- **Priority:** P2
- **Status:** open
- **Context:** v1 砍/缓的工具，等真用到再补：`read_page`（observe+screenshot 覆盖读需后才需要的长正文 dump，且需自带正文提取）；`list_pages`/`switch_page`（v1 用 opener stack 顶着，多页真复杂了再显式化）。
- **Notes:** 详见设计文档"Eng-Review 决策修订"。

### Browser 责任护栏（想做时）

- **Priority:** P2
- **Status:** open
- **Context:** v1 明示无护栏（"相信 AI"），eval 全权、写操作直执行。终态若要边界：写操作 pending→confirm、不可逆动作经 messaging 升级给创造者批准、按域 allowlist、action journal 审计。三次跨模型评审都点了这个软肋，留作知情后续。
- **Notes:** 依赖上面"工具异步调用"原语做升级问答更顺。

### Browser 隔离 reader / 目标委派（长会话再上）

- **Priority:** P3
- **Status:** open
- **Context:** v1 交互观察直进主上下文。若长会话被语义树+截图撑爆压缩频繁：重读走隔离子 Agent 只回摘要（B），或整任务委派 Browser TaskAgent 只回结果（C）。`read_page`/observe 已留干净函数接缝。多身份/多 profile（终态自有网络身份）也归此批。
- **Notes:** 详见设计文档 Approaches B/C。

---

## web

### 评估把 web 前端做成服务器渲染应用（Next.js 一类）

- **Priority:** P3
- **Status:** open（**「独立进程」这半已由 #578 落地，剩下的只是 SSR 本身**）
- **Context:** 原始想法含两件事：①前端成为独立服务进程；②服务端渲染。**①已完成**（#578）：`apps/web` 自持轻量静态服务器成为 `kagami-web` 进程，gateway 退化为纯反代，构建期 dist 装配耦合消除。**②SSR 仍未做，且 2026-07-25 复核后仍判定不划算**：管理台是 localhost 单用户、零 SEO、无访问鉴权的内网工具；14 个路由全部 lazy + TanStack Query 客户端取数 + Recharts 必须客户端水合，真 SSR 要重写全部页面数据层，换来的只是骨架屏消失；app-shell SSR 则是「名义 SSR」，Next 迁移与水合面的代价却要全付。
- **Notes:** 若将来仍要上 SSR（如出现对外页面 / SEO / 慢网络场景），起点已经好很多：进程、端口、PM2、部署别名、gateway 反代都就位，只需把 `apps/web` 的框架从 Vite 换成 Next 并保留同一进程形态。届时可一并重估 web 侧契约消费方式。

---

## Web 设计走查（2026-06-30 /design-review）延后项

### landing 统计大色块需后端聚合数据

- **Priority:** P2
- **Status:** open
- **Context:** 「鲜艳蒙德里安」方向要把 `main-agent-context` landing 做成二维大色块 dashboard（LLM token / 主动发言数 / 高成本 / scheduler pending / context tokens 等填实色块）。但当前 `main-agent-context` 接口只返回 `recentItems`，没有这些聚合统计。要真实呈现需**改后端 + shared schema** 加聚合字段，属跨前后端的新功能。前端这轮只在数据已就绪处上大色块（Auth 额度），landing 暂留 feed + 轮询状态，不硬编假数。
- **Notes:** 设计样张见 `/private/tmp/kagami-v3-light.html`（二维构图 + 大色块）。后端补聚合后，landing 按该构图实现。

### 填实状态色块铺到剩余数据页

- **Priority:** P3
- **Status:** in-progress（2026-07-01 /design-review DR-4 已做大部分）
- **Context:** 已改填实语义变体：app-log 级别、scheduler 状态、llm-history 状态。**剩余**：NapCat 事件 / QQ 消息行**没有**类型徽章（要新增 event=signal/message=llm 的填实行标，属 additive）；llm-history 详情的 message role badge 仍 `secondary`（role→语义映射偏主观，待定）。
- **Notes:** 后端没起时无法逐页视觉验证，本轮按 enum 映射 + build/类型校验为准；跑通后端后再目检。napcat 行标是新增控件，单独评估。

### 历史表格行键盘可达（a11y）

- **Priority:** P2
- **Status:** open
- **Context:** llm-history / app-log / napcat-event / napcat-group-message / oss / todos 六个页面用 `<TableRow onClick>` 做行选择，无 `role`/`tabIndex`/`onKeyDown`/focus-visible，键盘用户不可达（Codex 指出；2026-07-25 复核仍为这 6 处）。属交互行为改动，超出本轮 CSS-first 范围。
- **Notes:** 给行加 `role="button" tabIndex=0`，回车/空格触发，补 focus-visible ring；或抽成可复用的可点击行组件。

### 抽共享 Input 基元

- **Priority:** P3
- **Status:** open
- **Context:** 7 个 history 页面的过滤输入框/textarea 都是手抄一长串 class（`rounded-none border bg-background px-3 py-2 …`），focus ring 靠复制维护，必然漂移（子 Agent + Codex 都点了）。抽 `components/ui/input.tsx` 统一。
- **Notes:** 统一 focus ring 与边框 token。（原 MetricCharts 页的 input/textarea class 随 #444 删页一并移除，无需再并。）

### Auth 趋势图面积渐变（待定）

- **Priority:** P3
- **Status:** open
- **Context:** AuthPage 趋势 AreaChart 用 `<linearGradient>` 做面积淡出填充，Codex 按「色块内永不做渐变」标了。判断题：面积图淡出是数据可视化惯例，未必算装饰性「色块」。若决定严格扁平，改 Area 为 flat `fillOpacity` 并删 defs + 清掉随之未用的 `providerKey` 形参链。
- **Notes:** 留给用户定夺要不要图表也强制纯色。

### scheduler 黄不可作浅底文字（护栏）

- **Priority:** P3
- **Status:** open
- **Context:** `--scheduler`（赭黄）当浅底文字仅 ~1.96:1，严重不达 AA。当前仅作 `bg-scheduler text-scheduler-foreground` 使用（安全）。永远不要引入 `text-scheduler` 落在中性底上。
- **Notes:** 已是配给制约束，记此防回归。
