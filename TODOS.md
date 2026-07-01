# TODOs

待办事项清单。按模块 / 主题分组，组内按优先级 P0 → P3 排序。完成的项移到底部 `## Completed`。

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

### 治理对外部时间/外部条件的直接依赖，核心逻辑改为可注入的状态机

- **Priority:** P2
- **Status:** open
- **Context:** 代码里直接使用 `setTimeout` 这类依赖外部时间（或其他外部条件）的写法散落在业务逻辑中，导致核心逻辑难以单测、行为不确定、时序耦合。目标是把核心业务逻辑写成一个**无外部依赖（或纯依赖注入）的状态机**：把时间、随机、IO 等外部因素从核心逻辑里剥离，通过输入事件 / 注入的时钟驱动状态转移，副作用以"指令"形式回传给外层执行。最典型的参照实现是 etcd 的 raft —— 核心状态机纯函数化、`tick` 驱动、外部只负责把网络/磁盘/时钟喂进来并执行它产出的动作。
- **Notes:** 先盘点现有 `setTimeout` / `Date.now()` / 直接读时钟的调用点（事件队列、wait 工具、通知批窗、调度器、重连退避等），评估哪些属于"核心逻辑"应当被状态机化，哪些是外层适配可以保留。改造时注意不要破坏 KV 缓存前缀稳定性原则。

---

## scheduler

### `ithome_article` / `ithome_feed_cursor` 的清理策略

- **Priority:** P1
- **Status:** open
- **Context:** 当前 `apps/server/src/scheduler/tasks/data-retention/retention-tasks.ts` 显式把 `ithome_article` 与 `ithome_feed_cursor` 排除在每日清理之外（[retention-tasks.ts:41](apps/server/src/scheduler/tasks/data-retention/retention-tasks.ts:41)）。RSS 文章既不像日志那样安全按时间清掉，也不像 Story 记忆那样需要永久保留 —— 需要单独想清楚保留窗口、与 Agent 召回路径的关系、以及 `ithome_feed_cursor` 在重置后如何避免重新拉取已读旧文章。
- **Notes:** 决策前不要简单地把它加进 `RETENTION_TASKS`。

---

## napcat

### 合并转发里小镜看不到自己的消息（NapCat / NTQQ 上游限制）

- **Priority:** P3
- **Status:** open
- **Context:** 在「和小镜的私聊」里选中**包含小镜自己发出的消息**生成合并转发、再发给小镜，小镜用 `view_forward` 展开时**看不到其中自己（本账号 `714457117`）的那部分消息**，只看得到对方的消息。已 live 实测确诊：转发 `7656887019929762382` 实际含 4 条（闻震 2 条 + 小镜 2 条），但 NapCat 经 `get_msg` 与 `get_forward_msg` **都只返回 2 条对方消息，小镜自己的 2 条彻底不在返回里**（无隐藏节点、无 `user_id=0` 占位）。根因在 NapCat / NTQQ 数据层：按 `resId` 重建合并转发时，本账号自己发出的消息在进入 NapCat 解析**之前**就已不存在——NapCat 源码 `parseMultiMessageContent` / `parseMessageV2` 并不过滤 self（self 消息只会被打 `post_type: message_sent` 照常返回），所以不是 NapCat 故意过滤，而是上游 NTQQ 没把 self 节点交出来。**客户端无解**：数据从源头就没到我们手里，换任何 OneBot 接口结果一致。与我们的 `view_forward` 实现无关（[0.3.1.6] 的 node-napcat-ts 对齐、[0.3.1.10] 的 get_msg 主路径都已确认无关）。
- **Notes:** 对路的修法是**上报 NapCat**（NTQQ 重建合并转发时丢本账号自己的消息）。本地不要做脆弱的兜底拼接：缺失节点完全空白，转发段只给 `{id}` 不带条数摘要，我们既拿不到小镜消息的 message_id / 时间戳，也没有"少了几条"的信号，无法可靠还原，靠时间戳穿插猜测极易张冠李戴。相关 live 验证：forward `7656887019929762382` 实测返回 2 / 实际 4。

---

## Completed

<!-- 完成后的条目按完成日期倒序，附 PR 链接。例：
### 拆分 LLM 调用历史列表/详情接口

- **Priority:** P1
- **Completed:** 2026-05-23, [#72](https://github.com/KisinTheFlame/kagami/pull/72)
-->

### 接入高德 Web API

- **Priority:** P2
- **Completed:** v0.3.6.0 (2026-07-01), [#182](https://github.com/KisinTheFlame/kagami/issues/182)
- **Notes:** 做成可 `enter` 的高德地图 App（`server.apps.amap`，8 个 InvokeTool 子工具，含静态地图出图）。

## oss

### OSS 上传/下载流式化 + 并发/内存上限

- **Priority:** P2
- **Status:** open
- **Context:** `apps/oss/src/http/server.ts` 当前把整个 POST body buffer 进内存（`readBody` 累积 + `Buffer.concat`，峰值约 2× body），GET 也一次性 `readFile` 整个 blob；50MB 上限只是单请求级，无并发上限。N 个并发大上传可把单进程打到 OOM。设计阶段已把"流式落临时文件 + 边写边 hash"列为下一轮项；同时应加并发上限和 `server.requestTimeout`/`headersTimeout` 防 slowloris。/ship 对抗式评审（Claude + Codex 双模型一致）发现。当前仅 localhost、单一可信消费方（server），风险可控。
- **Notes:** 流式化后 ObjectStore.put 需接受 stream 而非 Buffer；GET 改 `createReadStream` pipe。

### OSS 落盘 fsync 持久化

- **Priority:** P3
- **Status:** open
- **Context:** `apps/oss/src/store/object-store.ts` 的 `ensureBlobFile` 只 `writeFile` + `rename`，未 fsync 文件与目录。断电/内核崩溃后可能 SQLite 事务已提交（库说有）但文件内容/目录项未落盘（文件空或丢失），`sweepOrphans` 只回收"文件在、行不在"，不修复"行在、文件没内容"。Codex 对抗式评审发现。概率低且内容可重新拉取（QQ 图片源可重取 + put 自愈），故定 P3。
- **Notes:** 修法：写完 tmp 后 fd.sync()，rename 后再 fsync 父目录。

---

## resource（资源 / 文件能力）

### QQ 群文件的列表查询、上传、下载

- **Priority:** P1
- **Status:** open
- **Context:** 给小镜的 QQ App 增加群文件能力：列出群文件、上传文件到群、从群下载文件。上传与下载都走自建 OSS 作为中转——下载即把群文件落进 OSS 成为一个 res，上传即把 OSS 里的 res 推到群文件。视角上这是"给 Agent 的生活添一种新的存在方式"，群文件只是 QQ App 内的一个能力，概念不要泄漏到 runtime。
- **Notes:** 依赖下面的 `download_resource` / `upload_resource` 全局工具与 OSS。NapCat 侧需要对应的群文件 list/upload/download 协议接口。

### `download_resource` 全局工具

- **Priority:** P1
- **Status:** open
- **Context:** 提供一个全局工具 `download_resource`，允许小镜把一个 res 下载到它指定的路径。文件名必须由小镜来给出（而不是沿用 res 自身的 key / 内容寻址名）。这是把 OSS 里的资源落地成本地文件的桥。
- **Notes:** 作为全局工具暴露——评估是否真的需要顶层工具，还是仍走 InvokeTool 子工具（按 KV 缓存原则，新增能力第一反应是做成 InvokeTool 子工具，除非它是结构性元能力）。入参至少含 res 标识 + 目标路径 + 文件名。

### `upload_resource` 全局工具

- **Priority:** P1
- **Status:** open
- **Context:** 提供一个全局工具 `upload_resource`，允许小镜把一个指定路径的本地文件保存进 OSS，得到一个 res。是 `download_resource` 的反向操作，把本地文件提升为可被其他能力引用的 OSS 资源。
- **Notes:** 同样评估顶层工具 vs InvokeTool 子工具。复用 OSS 现有的 sha256 内容去重 + refcount；入参为源文件路径。

---

## todo

### 自动推荐可新增的待办事项

- **Priority:** P3
- **Status:** open
- **Context:** 让小镜在自己的生活里自发地发现"有什么值得做的事"，并把它作为候选待办推荐进 todo App，而不是只能被动地记录别人交代的事。符合"给 Agent 的生活添一种新的存在方式"的视角——他会观察、会有兴趣、会主动给自己列计划。
- **Notes:** 设计阶段想清楚推荐的触发时机（空闲时刻的后台动作 vs 某些事件后）、推荐内容的来源（最近对话、读到的新闻、未完成的话题），以及如何避免噪音/重复推荐。注意 KV 缓存友好：推荐过程产生的中间素材不要进主上下文，走子 Agent / Operation 只回候选摘要。

---

## browser（Browser App 设计衍生，2026-06-27 /plan-eng-review）

### 运行时"工具异步调用、稍后回结果"原语

- **Priority:** P1
- **Status:** open
- **Context:** Browser App 的浏览器动作会阻塞单线程主循环（humanize + 慢站，单动作可达数秒），延迟 Kagami 对 QQ 等事件的响应。v1 用有界阻塞 + 收紧 `actionTimeoutMs` 顶着，但根因是运行时缺"tool 返 `pending`、完成后再唤醒主循环"的能力。这是横切能力：terminal 长命令、web-search 也都受益，浏览器只是第一个撞上它的地方。
- **Notes:** 与 wait/event 循环、Effect 模型对接；做成后 Browser/terminal 长动作改异步。设计文档见 `~/.gstack/projects/KisinTheFlame-kagami/kisin-claude/exciting-driscoll-d160ec-design-20260627-164048.md`（T2 节）。

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

## Web 设计走查（2026-06-30 /design-review）延后项

### landing 统计大色块需后端聚合数据

- **Priority:** P2
- **Status:** open
- **Context:** 「鲜艳蒙德里安」方向要把 `main-agent-context` landing 做成二维大色块 dashboard（Story 总数 / LLM token / 主动发言数 / 高成本 / scheduler pending / context tokens 等填实色块）。但当前 `main-agent-context` 接口只返回 `recentItems`，没有这些聚合统计。要真实呈现需**改后端 + shared schema** 加聚合字段，属跨前后端的新功能。前端这轮只在数据已就绪处上大色块（Auth 额度），landing 暂留 feed + 轮询状态，不硬编假数。
- **Notes:** 设计样张见 `/private/tmp/kagami-v3-light.html`（二维构图 + 大色块）。后端补聚合后，landing 按该构图实现。

### 填实状态色块铺到剩余数据页

- **Priority:** P3
- **Status:** in-progress（2026-07-01 /design-review DR-4 已做大部分）
- **Context:** 已改填实语义变体：app-log 级别、scheduler 状态、llm-history 状态、story matchedKinds/人物、playground StateHint。**剩余**：NapCat 事件 / QQ 消息行**没有**类型徽章（要新增 event=signal/message=llm 的填实行标，属 additive）；llm-history 详情的 message role badge 仍 `secondary`（role→语义映射偏主观，待定）。
- **Notes:** 后端没起时无法逐页视觉验证，本轮按 enum 映射 + build/类型校验为准；跑通后端后再目检。napcat 行标是新增控件，单独评估。

### 历史表格行键盘可达（a11y）

- **Priority:** P2
- **Status:** open
- **Context:** llm-history / app-log / napcat-event / story 等页面用 `<tr onClick>` 做行选择，无 `role`/`tabIndex`/`onKeyDown`/focus-visible，键盘用户不可达（Codex 指出，4 处）。属交互行为改动，超出本轮 CSS-first 范围。
- **Notes:** 给行加 `role="button" tabIndex=0`，回车/空格触发，补 focus-visible ring；或抽成可复用的可点击行组件。

### 触控目标 44px（移动端）

- **Priority:** P3
- **Status:** done（2026-06-30 /design-review F10，commit 9da64b8）
- **Context:** 导航项 / `Button size="sm"` / Codex-Claude 切换标签 / select 原 36–40px。已用 `max-md:` / `md:min-h-0` 仅在移动断点抬到 ≥44px，桌面密度零改动；390px 实测无 <44px 交互目标。
- **Notes:** 桌面（≥md）保持原 36/40px 密度。

### 抽共享 Input 基元

- **Priority:** P3
- **Status:** open
- **Context:** 7 个 history 页面的过滤输入框/textarea 都是手抄一长串 class（`rounded-none border bg-background px-3 py-2 …`），focus ring 靠复制维护，必然漂移（子 Agent + Codex 都点了）。抽 `components/ui/input.tsx` 统一。
- **Notes:** 把 MetricCharts 的 inputClassName/textareaClassName 也并进去。

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
