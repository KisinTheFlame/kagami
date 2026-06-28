# Changelog

本项目所有重要变更记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
本仓库启用 4 位版本号 `MAJOR.MINOR.PATCH.MICRO`，事实来源为仓库根目录 `VERSION` 文件，`package.json` 的 `version` 字段与之保持同步。Kagami 自部署、不对外分发，版本号仅用于标记部署节点与变更归档，不承载语义化版本对外兼容承诺。新条目按提交时间倒序追加在 `## [Unreleased]` 下，发布时归档到对应版本分节（`## [x.y.z.w] - YYYY-MM-DD`）。每个 PR 必须 bump `VERSION`（CI 强制校验 PR 版本号高于 master）。

## [Unreleased]

## [0.3.0.0] - 2026-06-29

### Added

- agent: 新增**异步工具调用原语**，让长耗时工具（如 `search_web` 子 Agent 多轮检索）不再同步卡死主 Agent 整轮——发起后主 Agent 立即解放，可继续处理新 QQ 消息等生活输入，结果稍后自动回流。通用 `AsyncTaskManager`（`@kagami/agent-runtime`）：工具 `submit` 一个后台 thunk、同步拿 `task_id` 立即返回占位 `<async_task_submitted>`（满足 ReAct「每 tool_call 紧跟一个 tool_result」契约），后台跑完 / 出错 / 超时时经 `onComplete` **恰好一次**回调；配 manager 级安全超时（`server.agent.asyncTask.maxTaskDurationMs`，默认 10 分钟，是无 cancel 工具前提下「每个任务必在有限时间内回流一次」的唯一兜底）、超时晚到的 settle 被吞掉不产生 unhandled rejection、无并发上限。结果回流复用 Story Recall 已验证链路：`AsyncToolResultCompletedEvent` 入事件队列 → session 路由装配成 `<async_tool_result task_id=...>` user message **追加到尾部**并触发新一轮，凭 task_id 对应回当初的发起——KV 前缀只追加不回写。占位由框架统一产出（`AsyncTool` 装配器，组合而非继承：`executeTyped` 独占产占位、工具经注入的 `prepareAsync` 接入、无继承覆写面），工具无权自定义占位格式，与 `wait` 工具「不实现协议本体、只声明意图」同构。root system prompt 增异步协议小节教 Agent 一次（前缀仅此一次成本，与异步工具数量无关）。首个消费者 `search_web` 改异步（`createSearchWebTool` + `prepareSearchWeb` 纯函数装配），同步门控 / 快照捕获保持不变。新增 agent-runtime +10 / server +9 测试，覆盖 submit-不-await / 恰好一次 / 超时(fake timer) / 并发 / 超时晚到不泄漏 / reject-不-submit / session 路由三态（[#141](https://github.com/KisinTheFlame/kagami/issues/141)）
- 资源(多媒体)能力：给小镜补上「读回 / 转发已存资源」这条线，让资源从一次性投影变成可读、可回溯、可分享的一等公民（[#135](https://github.com/KisinTheFlame/kagami/issues/135)）。包含四块：(1) `OssClient.getObject(resId,{maxBytes})` —— 按 resId 取回字节+MIME，404→`OSS_OBJECT_NOT_FOUND`，content-length 早拒 + 实际字节兜底→`OSS_OBJECT_TOO_LARGE`，作为读/发共享地基；(2) `read_resource` 顶层全局工具（与 search_web/search_memory 同级）—— 按 resId 直连 OSS GET，图片原图入多模态上下文、非图片回元数据、错误自包含，注册时同步 root / web-search 子 agent / context-summarizer / playground 四处保持 LLM tools 逐字节相等（稳定前缀 8→9，一次性 KV 代价、集中提交）；(3) 浏览器截图叠加落 OSS —— 截图仍原图入上下文，同时 PUT OSS 返回 `resid` 便于日后转发/重看，PUT 失败或 OSS 关闭优雅降级（截图照常入上下文、无 resid）；(4) QQ `send_resource` 子工具 —— 按 resid 取字节以 OneBot `base64://` 形态发图（自包含、不依赖 napcat 访问 OSS，拆分部署安全），底层单一 `sendImage(target)` 按 `chatType` 内部分发群/私，出站只记 resid 不落 base64，刻意绕过 AI 味门控（图片非文本发言）。新增配置 `server.agent.resource.maxBytes`（默认 4 MiB，读/发共用上限）。v1 只接线图片资源（非图片回元数据/拒发），资源抽象媒体无关、签名为未来视频/音频/文件预留。

### Changed

- ci: 把 CI workflow 里三个 action 升到当前最新大版本（`actions/checkout` v4→v7、`pnpm/action-setup` v4→v6、`actions/setup-node` v4→v6），这些大版本都跑在 Node 24 runtime 上，消除 GitHub Actions 关于 `actions/* 仍在 Node 20 上运行` 的 deprecation warning。纯 runtime 升级，无配置/行为变更：`packageManager: pnpm@10.18.3` 字段仍是 pnpm 版本唯一来源、`cache: pnpm` 在 setup-node v6 继续支持。
- server/console: 后端进程拆分第一步——把**服务前端管理台的纯 DB 查询**从单进程 `apps/server` 抽成独立进程 `@kagami/console`（Fastify，env `PORT` 默认 `20006`）。迁入 5 条纯查询链（handler + service + mapper）：`app-log` / `llm-chat-call` / `napcat-event` / `napcat-group-message` / `metric-chart`，经 `@kagami/server-core` 的共享 DAO 各自直读同一个 SQLite 库（console 只读 + metric-chart 写、stdout 日志）。`apps/server` **不改名、Agent 生活核心未动**，仅删除这些 query service 与 handler 注册（DAO 保留：日志 / 记录 / 持久化写入 / 打点仍需，`metricService` / `metricDao` 留给 agent 打点）。metric domain 按链拆分：chart 相关类型（`MetricChartItem` / `CreateMetricChartInput` / `MetricChartAggregator`）随 metric-chart 入 console，server 侧 `metric/domain/metric.ts` 收缩成只含 `MetricTags`（`Record<string,string>` 平凡别名，与 console 侧、server-core 侧同名定义结构等价、互通）。`scripts/web-server.mjs` 把这 5 个前缀的 `/api/*` 分流到 `kagami-console`、其余仍到 `kagami-server`；`ecosystem.config.cjs` 新增 `kagami-console`、`kagami-web` 加 `CONSOLE_TARGET`。两个后端进程并发读写同一库靠库文件级 WAL（两进程启动均 `configureSqlite`，Phase 1 写好的助手这步接线，已本地验证 `delete→wal`）。顺手修测试并发竞态：根 `test` 加 `--workspace-concurrency=1`，避免 console / server 两个 `pretest` 同时 `prisma generate` 撞 server-core 生成目录（`EEXIST`）。下一步「server 改名 `agent` + 内部控制面 + console 代理活操作」另开 PR（[#146](https://github.com/KisinTheFlame/kagami/pull/146)）
- todo: App 级回顾由**每天一次**改为**每天两次**（09:00 / 21:00）的统一提醒，并加入推动小镜规划的固定提示。每条 todo 自己的 `remindAt` 到点提醒（`reminder-tick`）不变，只动 App 级 digest：`DAILY_DIGEST_CRON` 由 `0 9 * * *` 改为 `0 9,21 * * *`（croner 原生支持 `9,21` 列表）；`TodoReminderPoller.runDigest` 去掉 `totalCount > 0` 守卫改为**无条件回调**——即使当前没有未完成项也照发，因为这条提醒除汇总未完成项外还要顺带提示小镜「去 todo App 按自己打算做的事添几条新待办」，空待办时同样需要推动规划。`TodoDigestDraft.render` 改为两段式：有未完成项时在「还有 N 件没做…」后追加创建提示，零未完成项时输出兜底文案「待办都清空了，没有未完成的事。」+ 同一句提示。两次回顾间隔 12h、共用 `sourceId="todo:digest"` 互不重叠，提醒仍经 NotificationCenter append 到尾部、不碰稳定前缀，对 KV 缓存中性。同步更新 digest draft 渲染与 runDigest 空待办两处用例
- todo: `add_todo` 工具把 `note` 与 `remindAt` 由可选改为**必填**（`repeatEvery` 仍可选），让每条新建待办都带备注与未来提醒时刻、到点必走通知。强制点落在工具的 Zod schema 与 `parameters.required`，并同步收紧 todo App `help()` 文案（`add_todo(title, note, remindAt, repeatEvery?)`）；`TodoService.addTodo` 签名刻意保持宽松（tool 是 Agent 唯一写入口，service 为内部 API），DB 列保持 nullable、不迁移、不回填存量。保证的是「创建时必填」而非全局不变量——一次性提醒（无 `repeatEvery`）触发后 `remindAt` 仍按既有设计被 `clearReminder` 清空。补 `缺 note` / `缺 remindAt` → `INVALID_ARGUMENTS` 两个用例，并修 happy-path 与「过去 remindAt → INVALID_TIME」用例补齐必填字段

### Fixed

- llm: 修 [#127] 同源的**记录侧崩溃**。#127 把图片内容改 base64 + provider 映射走 `imageContentToBase64` 归一，但 `client.ts` 记录侧 `toRecordableContentPart` 仍 `Buffer.from(part.content, "base64")`；已被 JSON 毒过的历史图片消息（`{type:"Buffer",data:[]}` 对象）恢复后流到记录侧，对对象 `Buffer.from` 抛 `Received an instance of Object` → root agent loop 崩溃（生产部署 #127 后实测到，`invalid base64` 已消失但暴露此条）。记录侧也经 `imageContentToBase64` 归一；中毒对象随上下文压缩老化（[#128](https://github.com/KisinTheFlame/kagami/pull/128)）
- llm/agent: 修复**多模态图片内容经持久化后 base64 失效**导致主 Agent 卡死的问题。`LlmImageContentPart.content` 原为 `Buffer`，而 Browser App 的 `screenshot` 是首个把图片放进**主 Agent 持久上下文**的场景——图片消息会随快照 / ledger 按 JSON 存，`Buffer` 经 JSON 往返变成 `{ type:"Buffer", data:[...] }` 不再是 Buffer，provider 侧 `part.content.toString("base64")` 于是产出 `"[object Object]"`，Claude API 报 `image.source.base64: invalid base64 data`；坏图留在历史里，每轮重发、每轮失败。修法：把 `LlmImageContentPart.content` 改为 **base64 字符串**（JSON 原生、往返不变、正是各 provider wire 格式所需），生产者（vision / playground / screenshot）在边缘 `toString("base64")` 一次；新增 `@kagami/llm` 导出 `imageContentToBase64(unknown)` 防御性归一，兼容 base64 字符串 / Buffer / `{type:"Buffer",data:[]}` 三态，让 4 个消费者（claude / openai-codex / openai-chat-mapper / 记录侧）对**已被 JSON 毒过的历史图片消息**也能恢复成合法 base64，无需手动改库；快照恢复 schema 放宽为永不拒绝（否则旧中毒快照恢复失败会丢上下文）。vision / playground 既有图片路径同步迁到字符串契约。新增 `imageContentToBase64` 三态回归测试（[#127](https://github.com/KisinTheFlame/kagami/pull/127)）

### Removed

- agent-runtime: 删除两个**零引用的 `@deprecated` 兼容别名**——`AgentRuntime`（`TaskAgent` 的类型别名）与 `TaskAgentRuntime`（`BaseTaskAgent` 的空子类）。二者均诞生于早期重构（抽出 runtime 包 / 拆 ReAct 内核）时为平滑迁移留的过渡垫片，迁移完成后全仓库已无任何调用方：新名 `TaskAgent` / `BaseTaskAgent` 已全面接管（各 10+ 处引用），旧别名 0 处使用。`@kagami/agent-runtime` 是 `private` 包、不发布、唯一消费方为 monorepo 内的 `apps/server`，不存在需向后兼容的外部消费者——任何重命名都能在一个 PR 内原子改完，别名没有保护对象；`@deprecated Use X instead` 本身就是"催迁移、预告删除"的措辞而非"长期保留"。同步撤掉 `index.ts` 的对应 re-export。纯死代码清理，行为零变化（[#117](https://github.com/KisinTheFlame/kagami/pull/117)）
- agent: 清除**冷启动补水死链**与 **napcat 事件死分支**。`C2` 定调（不恢复冷启动补水、改 App 状态持久化 [#108](https://github.com/KisinTheFlame/kagami/pull/108)）后，这条链已是纯死代码：删 orphaned 的 `startup-context-hydrator.ts`（无人 import，却是唯一往主事件队列 enqueue napcat Event 的地方 → 永不执行）+ 其测试；删 `hydrateColdStartAgentContext` 的 no-op 调用链（index → server-runtime → factory 三处）与失去用途的 `restoredRootAgentSnapshot` 门控标志（`restorePersistedSnapshot` 本体保留、snapshot 恢复照常）；删 `hydrateStartupEvents`（host + RootLoopAgent 两处，唯一调用方即上面的 hydrator）；`Event` 联合收紧——移除 `napcat_group_message` / `napcat_private_message` / `napcat_friend_list_updated` 三个变体（只有死掉的 hydrator 在 enqueue），`createMessagesFromEvent` / `summarizeEvent` 的对应分支随之删除。行为零变化：napcat 事件本就直达 `QqApp.handleNapcatEvent`（#106 收纳后），这些路径运行时从不被触达；`event→ContextItem` 渲染入口保留（`createMessagesFromEvent` 恒返 `[]`）为未来新事件类型留口子。净删 ~569 行（[#111](https://github.com/KisinTheFlame/kagami/pull/111)）

### Added

- agent: 新增 **Browser App**，给小镜一个"上网的身体"——CloakBrowser（Playwright drop-in 的隐身 Chromium）有头驱动，能像人一样登录、点击、填表、读真实网站，登录态跨重启持久。经 office-hours 设计 + plan-eng-review 评审（8.5/10）+ 两轮 Codex 跨模型冷读。8 个 InvokeTool 子工具 `browser_navigate` / `observe` / `click` / `type` / `press` / `wait_for` / `screenshot` / `eval`，顶层工具集不变（KV 稳定前缀），子工具只在 `enter(browser)` + `help` 时披露。**感知**走 `page.ariaSnapshot({ mode:"ai", boxes:true })`——Playwright 原生给 `[ref=eN]` + `[box=x,y,w,h]` + iframe 内快照，点击经 `locator("aria-ref=eN")`，无需自建 ElementRegistry；ref 带 observe `epoch`，用旧 observe 的 ref 即拒（`STALE_REF`），不静默点错。**截图原图直接进多模态上下文**（不经 vision 转文字）：为此给 `append_message` Effect 加可选 `image`（Buffer + mimeType），带图时追加一条多模态 user 消息，向后兼容既有调用；聚焦密码字段时拒截、JPEG 降规格节流（截图较贵会推高压缩频率，见设计「截图预算」）。**凭据**新建 `browser_credential` 表（按 handle 存账密；`auth/` 的 secret store 是 per-provider encode/decode 不是通用键值库），`browser_type(secret_handle)` 按 handle 注入 `fill` 层，明文密码**永不进 tool result / 语义树 / 截图 / 上下文**，小镜只引用 handle、看不到明文。**多页 opener 栈**接住 OAuth 登录弹窗（新页压栈成活动页、关闭弹回 opener）；每动作探活，浏览器崩溃/关窗即重新 lazy-launch 并提示状态已丢；错误**冻结结构 + 丰富字段**（url/pageId/ref/epoch/locatorState）序列化，失败结果形状稳定。配置 `server.apps.browser.*` 只 4 个环境字段（`headless` 默认有头 / `userDataDir` / `proxy` / `licenseKey`），humanize/viewport/超时/截图尺寸是代码常量不进 config。`browser_eval` 是全权逃生舷（读写全开），v1 不做写操作护栏（知情延后，护栏 / 异步工具原语 / 隔离 reader 等已记入 TODOS）。单测覆盖 secret 不泄漏 / ref epoch 拒旧 / opener 栈 / 错误序列化；动作有界超时（浏览器动作阻塞单线程主循环，超时上限即 QQ 最坏延迟）（[#124](https://github.com/KisinTheFlame/kagami/pull/124)）
- napcat: QQ 支持**发送内置小表情**（`face` 段），与接收侧对称收口。出站文本解析 `parseOutgoingMessageSegments` 此前只认 `{@昵称(qq)}` 提及，现在同样识别 `[表情: 名字]` 标记并还原成 `face` 段——正是接收侧渲染出来的格式（见 `formatFaceSegment`），小镜照着自己收到的样子写就能把同样的表情发出去，无需新增工具或参数。名字经从兜底字典派生的 name→id 反查表（275 条名字唯一、无歧义）解析；查不到的名字（更高版本仅靠入站 faceText 渲染的表情）原样保留为文本一起发出，绝不静默丢弃。配套新增 QQ App 子工具 `list_faces()`——小镜只见过群友发过的表情，想发别的得知道名字，这个工具把可发送全集摊给他按需查阅（InvokeTool 子工具，顶层工具集不变；列表只在调用时作为 tool result 进尾部，对稳定前缀与 KV 缓存中性）；`help` 同步补一行可发现性提示。与 #118 的引用回复正交叠加：`buildOutgoingMessageSegments` 调用增强后的解析，表情在引用回复里同样生效（[#119](https://github.com/KisinTheFlame/kagami/pull/119)）
- napcat: 小镜支持**主动使用 QQ 引用回复**。此前小镜只能「看到」别人的引用回复（入站 `reply` 段已渲染成 `<reference>`），但自己发不了引用回复。这次补上发送方向，并补上前置条件：把每条消息的 QQ `message_id` 作为「回复哪条」的句柄渲染进 `<qq_message id="...">` 暴露给小镜（XML 属性而非内联文本，噪音小、不易被 LLM 当数字弄坏精度；消息没有 id 时不渲染该属性）。`send_message` 新增可选参数 `reply_to`（目标消息 id），gateway 出站按 OneBot 约定把 `reply` 段前置到 segment 数组首位构造引用回复（新增 `buildOutgoingMessageSegments`，`parseOutgoingMessageSegments` 仍只管文本/@ 解析）；`replyToMessageId` 沿 `AgentMessageService`→gateway 内部输入类型透传，HTTP wire schema（`/napcat/group/send`）保持纯净、回复字段只在内部类型上。被 AI 味门控拦下的引用回复经 `confirm_last` 补发时保留回复目标。渲染格式与工具 schema 都只一次性改动、集中提交，入站消息照旧 append 到尾部、不碰前缀历史，对稳定前缀与 KV 缓存中性（[#118](https://github.com/KisinTheFlame/kagami/pull/118)）
- napcat: QQ 支持**接收内置小表情**（`face` 段）。此前 `face` 段在渲染时被丢成空字符串，小镜完全感知不到群友发的表情（如「前 😄 后」只看到「前后」）；现在渲染成 `[表情: 名字]` 占位，与 `[图片: 描述]` / `[合并转发]` 的方括号约定一致。名字优先取 NapCat 给的 `raw.faceText`（最权威，规整掉 `/` 前缀和方括号），其次查内置兜底字典（id→中文名，275 条取自 QQ sysface 表 `QSid`→`QDes`、与 faceText 同源、逐条核对），都没有再退化成通用 `[表情]`。商城大表情（mface）在接收端本就走 `image` 段经 vision 描述、不在此列。纯入站渲染改动，只影响新消息 `rawMessage` 的生成（历史消息已存的 `rawMessage` 不重渲染），对稳定前缀与 KV 缓存中性（[#115](https://github.com/KisinTheFlame/kagami/pull/115)）
- agent: 新增 `todo` App，给小镜一个中立的个人待办本——只提供能力、不预设用法（自发记 / 群友托付、朝内做 / 回会话交付都交给她的 agency）。6 个 InvokeTool 子工具 `add_todo` / `list_todos` / `complete_todo` / `snooze_todo` / `update_todo` / `remove_todo`，顶层工具集不变（KV 稳定前缀）；灵魂是**到点 / 每日经通知中心提醒未完成项**：per-todo 提醒（细粒度 `sourceId`，仿 QQ 每会话一源）+ 每日 digest 汇总两层，均走 NotificationCenter 唯一桥。守两条红线——提醒**边沿触发**（空拍零 push、不空转刷轮次）、续期用 **O(1) 取模严格推过 now**（防停机后追赶式连刷）；续期 UPDATE 走 **CAS**（`status=pending AND remindAt=原值`）避免覆盖 agent 并发的 snooze / 改期；mutation 工具只返回**一行紧凑确认、不回贴整张清单**（防上下文膨胀）。tick / digest cron / active 上限 / repeat 下限均为代码常量不进 `config.yaml`；`todo_item` 表 soft delete（`status=removed`）、短自增 id 便于 LLM 引用；新增 46 条 vitest 覆盖红线路径（[#114](https://github.com/KisinTheFlame/kagami/pull/114)）
- agent: 新增 **Story Agent 启用开关** `server.agent.story.enabled`（默认 `true`），可整体关停后台 Story 写作 loop。关停时 index 不再 `initialize`/`run` `StoryLoopAgent`（shutdown 也不接管其 `stop`），且 `onLedgerAppended` 回调不再向 `storyEventQueue` 入队——否则 `ledger_appended` 事件会在无人消费下无界堆积。沿用既有 `recall.enabled` 同范式：与主 Agent 前缀完全无关，`search_memory` 顶层工具照旧注册、tools 列表字节不变，稳定前缀与 KV 缓存零影响（[#110](https://github.com/KisinTheFlame/kagami/pull/110)）
- napcat: QQ 接收的**所有图片对接自建 OSS**，上下文展示 resid。所有入站图片（群/私聊/历史/转发展开）都经唯一咽喉点 `analyzeImageSegment`，它本就下载图片字节喂 vision，现在一次下载同时把原图 PUT 进 `@kagami/oss` 拿 `res-N`，并在上下文渲染成 `[图片: 描述, resid: res-N]`，给小镜一个能稳定引用原图的句柄（为「图片原图直接进上下文、弃用 vision 转文本」铺路）。核心是内容寻址缓存：新增 `image_asset` 表（`file_id` = 图片内容 MD5，唯一 → `resid` + `description`），同一张图全局只下载/描述/PUT 一次，命中直接复用、连 vision 都跳过——resid 跨消息稳定、不膨胀，且消掉「每次出现都重 vision」的重复开销（净改进）。`analyzeImageSegment` 返回由 `string` 改 `{description, resid}`、消掉 `[图片:x]` 包了又拆的正则往返，resid 回填进 `segment.data.resid` 持久化、重渲染（如 open_conversation 拉历史）也稳定带 resid。新增 `OssClient`（`POST /objects`）+ `ImageAssetDao`；`server.oss` 配置可选，缺失/OSS 挂了优雅降级（resid 恒为 null、渲染退回 `[图片: 描述]`）（[#109](https://github.com/KisinTheFlame/kagami/pull/109)）
- agent-runtime: 新增**App 状态持久化能力**，把"App 自管自己的状态、跨重启保留"从各 App 手搓（如 Terminal 自带 DAO）抽成框架级通用能力。内核给 `App` 接口加可选 `exportState()/restoreState()` + 新增 `AppStateStore` 端口 / `JsonValue` 类型；`AppManager` 注入可选 store，`startupAll` 时 `load→restoreState`（先于 onStartup）、`shutdownAll` 时 `exportState→save`（先于 onShutdown、趁 App 仍活），恢复/存档失败都不阻断启动/关停，无 store 注入则整体 no-op。server 侧落一张**通用** `app_state` 表（`appId` PK / `state` Json / `updatedAt`，一张表服务所有 App）+ `PrismaAppStateStore`。首个接入方 QQ App（取舍 A：只存未读红点）——`exportState` 交出每会话 `{ unreadCount, mentioned }`（只存有未读的），`restoreState` 恢复、私聊会话按 id 现建空壳、已下架的群不复活；群/好友信息与消息原文仍从 napcat 实时重建、不入表，杜绝陈旧快照。效果：重启后"小镜欠多少没看"连续、不再清零，`open_conversation` 仍是唯一清零点。存档时机 shutdown-only（正常部署的 SIGTERM 干净关停必然落库，仅硬崩溃丢失自上次启动以来的未读，对红点量级可接受）。这条侧路与消息列表/前缀无关，对 KV 缓存中性（[#108](https://github.com/KisinTheFlame/kagami/pull/108)）
- agent: QQ 支持查看**合并转发消息**（聊天记录）。此前 `forward` 段在渲染时被丢成空字符串，小镜完全看不到群里转发的内容；现在 napcat 渲染器把它渲染成 `[forward_id: <res_id>]` 占位（无 id 退化 `[合并转发]`），并新增 QQ App 子工具 `view_forward(forward_id, offset?)` 按需调 OneBot `get_forward_msg` 展开——遵循 KV 缓存优先：不 eager 内联，大段聊天记录只作为 tool result 进尾部，`view_forward` 是 InvokeTool 子工具、顶层工具集不变。vision 复用是关键优雅点：转发里每条消息当普通私聊消息丢进**同一条 `normalize` 管线**，图片自动走和普通消息相同的 `analyzeImageSegment`、不另起 vision 路径，嵌套转发只渲染成占位不递归（想看再展开一层）。分页默认每页 50 条、`offset` 翻页，gateway 内「原始节点 + 当页结果」双缓存（TTL 10min）让翻页不重拉 `get_forward_msg`、不重烧 vision；分层与 `getRecentGroupMessages` 对齐（napcat 层出已描述好的节点、QQ App 层只拼 `<qq_forward>`，原始图片字节不进主上下文）；`get_forward_msg` 入参（`id`+`message_id`）与返回结构（`messages`/`message`、扁平/`node` 节点）做了多版本容错（[#107](https://github.com/KisinTheFlame/kagami/pull/107)）
- oss: 新增自建对象存储服务 `@kagami/oss`（独立 PM2 进程 `kagami-oss`，仅 localhost `:20005`）。业务无关的内容寻址 blob 仓库——对外不透明短 key `res-<自增 id>`（`AUTOINCREMENT` 永不复用），对内按 sha256 去重 + 引用计数，多 key 可指同一份内容、删一个不误伤共享内容。`node:http` + 裸 `better-sqlite3`（自有 `data/oss/oss.db`、零 `@kagami/*` 依赖、启动幂等建表 + WAL + 外键），blob 裸文件按 sha256 前缀分片落 `data/oss/blobs/`，文件 I/O 走异步 `fs/promises` 不阻塞事件循环。崩溃一致性：文件 I/O 在事务外、库为唯一事实来源，崩溃只留无害孤儿、启动 `sweepOrphans` 回收；写操作（put/delete）走进程内写锁串行化，消除并发场景下"delete 的提交后 unlink 删掉并发 put 刚重建文件"的数据竞态；GET/HEAD 回放上传方 Content-Type 时强制 `nosniff` + `attachment` 防内容嗅探。仓库根锚点复刻 server 的 config.yaml 定位法，保证 data 落仓库根而非 PM2 cwd。本轮只搭服务、不接 Agent（后续才把 QQ 图片原图直接喂进上下文，替代 vision 转文本）。经 office-hours 设计 + plan-eng-review 评审 + 双模型对抗式评审（[#105](https://github.com/KisinTheFlame/kagami/pull/105)）
- ci: 新增 GitHub Actions CI（`.github/workflows/ci.yml`），在 PR 与 master push 上跑 `build` / `typecheck` / `lint` / `format` / `test` 全套门禁，把"提交前手动跑四件套"变成强制关卡。整条门 config-free（`prisma generate` 用占位 `DATABASE_URL`、测试不读运行时 config），CI 无需伪造 `config.yaml`；Node 22 + pnpm（走 `packageManager` 字段），原生依赖（better-sqlite3 / hnswlib-node 等）按 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 编译（[#92](https://github.com/KisinTheFlame/kagami/pull/92)）
- agent: 新增 `hn` App，给小镜一个只读的 Hacker News 地点（agency 优先：进门不自动拉榜、无未读提醒，想看才看，区别于 ithome 的"推未读"节奏）。4 个 InvokeTool 子工具 `glance_hn` / `open_hn_thread` / `search_hn` / `open_hn_user`，顶层工具集不变（KV 稳定前缀）；feed 列表用官方 Firebase API、评论树与搜索用 Algolia API（搜索 / 嵌套评论树 / 用户主页都是 RSS 做不到、HN 原生的能力）；整个 App 自包含在 `agent/apps/hn`（无轮询 / 无 DB / 无 cursor，刻意不照搬 ithome 的 RSS 驱动结构）；`open_hn_thread` 按最热闹子树优先 + 限深限量 + 字符预算截断；所有 HN 文本过 `htmlToPlainText` 清洗（去标签 / 解码实体 / 软化尖括号）防上下文结构注入；onFocus 只返静态提示屏、无网络 I/O（[#86](https://github.com/KisinTheFlame/kagami/pull/86)）
- agent-runtime: 为此前零测试的核心包 `@kagami/agent-runtime` 补上 vitest 测试基建，新增 26 条不变量测试，直接测源码、不依赖构建；覆盖 Effect 解释器（`ReplaceLeadingMessages` 唯一前缀重建路径且传副本、无匹配 / Noop 收到 effect 即抛绝不静默吞）、事件队列（FIFO、一次 enqueue 唤醒全部 waiter）、串行执行器（严格串行不交错、单任务抛错隔离）、`ZodToolComponent`（非法参数永不进 `executeTyped`、业务抛错转结构化结果）；根目录 `pnpm test` 现已覆盖该包（[#87](https://github.com/KisinTheFlame/kagami/pull/87)）
- agent: 新增 `clock` App，提供 `view_time` 工具让 Agent 主动查询当前北京时间（精确到秒）；与 Wake Reminder 降频（[#77](https://github.com/KisinTheFlame/kagami/pull/77)）形成被动 + 主动的时间感知闭环（[#79](https://github.com/KisinTheFlame/kagami/pull/79)）
- agent: App 间**直接切换的 `switch` 工具**。此前换地点只能 `back-to-portal` 回桌面再 `enter`，现在 `switch(<appId>)` 一步切焦点；顶层工具集多一个结构性导航元工具（与 `enter` / `back-to-portal` / `help` 同类，对 KV 稳定前缀中性）。同时清理状态树退役遗留的残余代码（[#104](https://github.com/KisinTheFlame/kagami/pull/104)）
- agent: QQ **群通知显示发送者 + 未读计数归属 QQ App**。通知里带上"谁发的"，让小镜不进会话也能判断要不要回；未读计数从全局状态收归 QQ App 自管，为后续 App 状态持久化铺路（[#103](https://github.com/KisinTheFlame/kagami/pull/103)）
- agent: **手机 OS 模型 PR2——聊天 App 化为 QQ App，状态树退役**。把原本散在 runtime 里的"聊天状态节点"整体收成 `agent/apps/qq` 下的 QQ App：会话模型、入站事件处理、出站发送都归 QQ App 自管，Portal 下 `enter(qq)` 才进入。旧的全局状态树（zone / 状态机）正式退役，Agent"在哪个地点"改由 App 焦点表达；群聊概念彻底收口到 QQ App，不再泄漏进 runtime 核心抽象（[#99](https://github.com/KisinTheFlame/kagami/pull/99)）
- agent: **手机 OS 模型 PR1——被动 `NotificationCenter` + IThome 文章改走通知**。新增源无关的 `NotificationCenter` 作为各 App / 源到 Agent 的唯一桥：聚合各源 push 的通知草稿、按窗口节流后 enqueue 一个 `notification` 事件唤醒 Agent。IThome 文章不再走专用事件，而是和 QQ 消息一样折叠成通知，确立"一切外部信号皆生活输入"的统一入口（[#93](https://github.com/KisinTheFlame/kagami/pull/93)）
- agent: 接入 **AIRadar 为小镜发言增加 AI 味实时门控**。`send_message` 出站前对文本实时打分，超阈值（默认 0.8）拦下、走 `confirm_last` 让小镜重写，压制最严重的"AI 腔"堆叠句；权重模型随后在 #100 进一步抽成静态 JSON（[#83](https://github.com/KisinTheFlame/kagami/pull/83)）

### Changed

- agent: **QQ 会话导航去掉 `back_to_conversation_list`，改 `list_conversations`（纯读）+ 任意时刻 `open_conversation` 切焦点**。旧 `back_to_conversation_list` 把"看列表"和"离开当前会话"耦在一个工具里（清焦点 + 重渲列表），强加了"先回列表再开下一个"的状态机。现在焦点只由 `open_conversation` 管（随时切到任意会话，无需先回列表），新增纯读子工具 `list_conversations`——列当前已知会话含未读、标注当前焦点，**不动 `currentConversationId`**。`openConversation` 与回到 QQ 的补档共用抽出的私有 `enterConversation()`（一份"清未读 + 清该会话 pending 通知 + 渲染"逻辑）。**焦点跨后台保留**：`onBlur` 不再清当前会话（回来能续上），但新增 `focused` 标志门控 `getCurrentChatTarget()`——仅前台才对外暴露发送目标，退出 QQ 后返回 `undefined`，堵住"离开 QQ 后顶层能力（send_message / search_web）仍看到 chat target"的泄漏（codex 跨模型评审指出，`focused` 不持久化、重启即 false）。`onFocus` 回到 QQ：先补档（清当前会话未读）再渲列表，输出会话列表（标注当前）+ 焦点会话后台期间收到的消息；`unreadCount` 超缓冲上限时提示"更早 N 条未读未展示"避免信息静默丢失，无新消息则给"当前会话期间无新消息"。子工具增删经 InvokeTool 披露、顶层工具集不变，对稳定前缀与 KV 缓存中性。新增 9 条 vitest 覆盖 focused 三路门控 / onBlur 保焦点 / onFocus 补档 / 超缓冲提示（[#133](https://github.com/KisinTheFlame/kagami/issues/133)）
- agent: **通知中心空闲首条改为前沿短窗聚合**。此前 NotificationCenter 是「前沿立即发 + 30s 节流」——空闲来第一条立即 flush 直达 Agent；现在空闲来第一条改为开一个 `leadingWindowMs`（默认 10s）的**前沿短窗**攒着、窗结束才 flush，用来聚合一小撮突发，避免首条一来就打断 Agent。窗结束仍有攒着的 → flush + 开 `windowMs`（30s）节流窗，空了回空闲、下一条重新走短窗；`openWindow(delayMs)` 改带时长参数（`push` 传 leading、窗结束传 batch）。新增配置 `server.agent.notificationLeadingWindowMs`（默认 10000）与兄弟 `notificationBatchWindowMs` 并列。只影响事件入队时机、不改消息序列化，对稳定前缀与 KV 缓存中性（[#120](https://github.com/KisinTheFlame/kagami/pull/120)）
- build/server: **test 前置构建 workspace 依赖**。vitest 经 `package.json` 的 `exports` 以 dist 形式消费 `@kagami/shared` 等内部包，干净 worktree 下 dist 缺失会解析失败、改 dist 不重建又会跑陈旧产物；新增 `pretest` 在 vitest 前先构建 server 的依赖包（`@kagami/server^...`，不含自身），让「dist 缺失 / 陈旧」不再咬人（[#120](https://github.com/KisinTheFlame/kagami/pull/120)）
- build/lint: ESLint 开启类型感知 linting（`typescript-eslint` `recommendedTypeChecked` + `projectService`，仅作用于各包 src，测试 / 配置文件不进 scope），抓 `no-floating-promises`（现状 0）/ `no-misused-promises` / `no-unsafe-*` / `switch` 穷尽 / `base-to-string` 等只有类型信息才能发现的问题。仅关闭 `require-await`（满足接口契约的 async，留着只有噪声）；`unbound-method` 的依赖注入解构误报改用**代码**消除（OAuth 工厂参数改 `deps.` 直接调用、依赖映射类型用箭头属性语法），不靠关规则；`no-unsafe-*` 暂设 `warn` 做棘轮（可见不阻塞，后续逐步收紧）；首轮高价值违例（冗余 union、`base-to-string`、模板表达式、回调 handler 改显式 `void` fire-and-forget 而非 inline disable 等）一并修掉（[#95](https://github.com/KisinTheFlame/kagami/pull/95)、[#96](https://github.com/KisinTheFlame/kagami/pull/96)）
- build/config: `prisma generate`（及 `pnpm build` / `typecheck`）不再依赖 `config.yaml`——`scripts/prisma.sh` 对 `generate` 子命令改用占位 `DATABASE_URL`，让纯代码生成 / 类型检查与运行时配置解耦；连库命令（`migrate` / `db push` 等）仍读真实 `server.databaseUrl`，缺失即报错不静默兜底。便于 CI / 全新 clone 在没有 `config.yaml` 时直接跑 build / typecheck（[#91](https://github.com/KisinTheFlame/kagami/pull/91)）
- agent: 顶层 `news` 模块塌缩为 `ithome` capability，消除"多源资讯"泛化。抓取 / 存储 / 轮询本体迁入 `agent/capabilities/ithome`（对标 `terminal` 范式的能力本体 + App 壳分层），App 壳保留在 `agent/apps/ithome`；删除 `source_key` 多源抽象：`IthomeNewsService`→`IthomeService`、表 `news_article` / `news_feed_cursor`→`ithome_article` / `ithome_feed_cursor`（游标退化为单行表）、事件 `news_article_ingested`→`ithome_article_ingested`、配置 `server.news.ithome`→`server.ithome`；迁移 `collapse_news_into_ithome` 以 rename + `INSERT SELECT` 保留已抓取文章与已读游标（[#90](https://github.com/KisinTheFlame/kagami/pull/90)）
- server: 数据库由外部 PostgreSQL + pgvector 迁移到**进程内 SQLite + hnswlib-node**，宿主机不再需要运行独立数据库。ORM 仍是 Prisma（adapter 换 `@prisma/adapter-better-sqlite3`）；schema 去掉 PG 专有类型，`EmbeddingCache.embedding` 与向量列改 `String`(JSON)；向量检索改进程内 HNSW（SQLite 为唯一事实来源、启动时重建）；metric / napcat / app-log 的原生 SQL 改写为 SQLite 方言；持久化数据统一进 `data/`（`sqlite/`、`vector/`）；重建 Prisma 迁移基线；旧 PostgreSQL 数据经一次性脚本搬迁（脚本不随仓库留存）（[#85](https://github.com/KisinTheFlame/kagami/pull/85)）
- agent: Wake Reminder 由每分钟降频为每半小时一次，同一半小时窗口（00 / 30 分桶）内的多轮 round 共享去重 key、不再重复追加；展示的时间值仍是真实触发时刻；长会话尾部 `system_reminder` 噪声减少约 30 倍，对 KV 缓存更友好（[#77](https://github.com/KisinTheFlame/kagami/pull/77)）
- build/config: `config.loader.ts` 与 `scripts/read-config.mjs` 在 git worktree 内找不到 `config.yaml` 时，自动通过 `.git` 文件解析主仓库根目录并读取其中的 `config.yaml`，让 worktree 不再需要拷贝 / symlink 配置即可跑 `pnpm db:generate` / `pnpm build`
- agent: 移除 `wait` 工具连续第 3 次调用时的 `<wait_blocked>` 短路限制；`wait` 现在总是产出 `wait_for_event`，由事件队列或最大等待时间正常恢复主循环
- llm-history: 拆分 LLM 调用历史列表 / 详情接口，`/llm-chat-call/query` 列表只返回 summary 字段，新增 `GET /llm-chat-call/:id` 详情接口；前端列表改为按选中 id 单独 fetch detail，降低列表响应体大小（[#72](https://github.com/KisinTheFlame/kagami/pull/72)）
- agent-runtime/llm: **Effect 复用层 + Operation 副作用化 + `@kagami/llm` 下沉去 `TMessage`**。ReAct 内核的副作用统一收敛成可复用的 Effect，能力实现改以 Operation 表达副作用；同时把 LLM 消息类型从带泛型 `TMessage` 的形态下沉为 `@kagami/llm` 的具体 `LlmMessage` 契约，前后端 / 内核共用一份定义（[#82](https://github.com/KisinTheFlame/kagami/pull/82)）
- llm: **`Tool` / `JsonSchema` 类型下沉到 `@kagami/llm`**，消除 server 与 runtime 各自重复定义的工具 / schema 类型，统一为单一契约来源（[#84](https://github.com/KisinTheFlame/kagami/pull/84)）
- agent: **AI 味模型权重抽成静态 JSON**，把 AIRadar 门控（[#83](https://github.com/KisinTheFlame/kagami/pull/83)）的权重从硬编码 TS 抽到独立数据文件，配合 eslint `ignores` 实现全仓零抑制（去掉最后一个 `@ts-nocheck`）（[#100](https://github.com/KisinTheFlame/kagami/pull/100)）
- agent: **通知改前沿触发 + 节流窗口**（安静直达 / 繁忙聚合）。空闲时来的通知前沿即发、直达 Agent；繁忙时落入节流窗口聚合，避免连续打断。是 #120「空闲首条改前沿短窗聚合」的前身（[#102](https://github.com/KisinTheFlame/kagami/pull/102)）
- agent: **通知改固定周期扫描 + 按 source 分组的新格式**，通知内容按来源（QQ / IThome 等）分组呈现，让小镜一眼看清各源各欠多少（[#101](https://github.com/KisinTheFlame/kagami/pull/101)）
- agent: **wake reminder 时间附带星期几**，被动时间提醒除时刻外补上星期，减少小镜推断日期的负担（[#116](https://github.com/KisinTheFlame/kagami/pull/116)）
- napcat: **模块内分层对齐 `domain` / `application` / `infra` / `http`**，把 napcat 从扁平文件重组为标准四层，与其余模块的分层范式一致（[#121](https://github.com/KisinTheFlame/kagami/pull/121)）
- test: **测试树按模块镜像 `src`**，消解横向的层目录，测试文件改为贴着对应源码模块组织（[#122](https://github.com/KisinTheFlame/kagami/pull/122)）
- build/lint: **全仓真正零 `eslint-disable`**，把 AI 味数据文件改用 eslint `ignores`、`.cjs` 配置层放行 `require`，收口为整仓无 inline disable（[#97](https://github.com/KisinTheFlame/kagami/pull/97)、[#98](https://github.com/KisinTheFlame/kagami/pull/98)）

### Fixed

- agent: 修复 `view_forward` 展开合并转发失败（线上 Kagami 连试 4 次都被拦、根本没走到 `get_forward_msg`）。根因：转发 res_id 是 19 位长数字，PR1 的占位符 `[forward_id: 7655…]` 直接露出裸数字，LLM 当 JSON number 传——既被 `string` schema 拦下（`Expected string, received number`），又因超出 JS 安全整数而丢精度（`…405394` → `…405000`）。修法：占位符给 res_id 加 `fwd-` 前缀（`[forward_id: fwd-7655…]`）强制它在 JSON 里只能是字符串、精度无损，`view_forward` 收到后剥前缀；schema 放宽成 `string|number`，收到纯数字时不静默转换（已丢精度）而是回明确提示让其改用字符串；help / 翻页提示同步带前缀（[#112](https://github.com/KisinTheFlame/kagami/pull/112)）
- agent: 修复 root agent 丢失 tool 的 `append_message` effect 产出消息的回归。#78 把 effect 应用下沉进 ReAct kernel 后，effect 翻译出的"屏幕"消息（App 列表 / 文章正文等）只进 `ReActRoundResult.appendedMessages`，而 `RootAgentHost.commitRoundResult` 仍只持久化 tool 结果 content + postToolEffects、从不落 `appendedMessages`——导致 `glance_hn` / `search_hn` / `open_hn_user` / `open_hn_thread` 以及 ithome 的列表 / 文章正文只在回合内可见、不进 ledger，下一轮主 Agent 只剩 tool_result 那句简短状态（如 `{"count":10}`），看不到真正内容。kernel 现在把 effect 产出挂到 `ReActToolExecution.effectMessages`，commit 按"tool 结果 → effect 屏幕 → postToolEffects"顺序持久化；新增 kernel 与 commit 两层回归测试（[#94](https://github.com/KisinTheFlame/kagami/pull/94)）

## 2026-05

### Added

- agent: Per-App config schema 自注册（#67）
- agent: Portal 展示已装 App 列表（#62）
- agent: Phase 2 — `BackToPortalTool` / `EnterTool` App 入口，落地第一个 App `calc`（#61）
- agent: Phase 1 App 框架抽象就位（空 `AppManager` + `HelpTool`）（#58）

### Changed

- agent/ops: 砍 dashboard 死代码并把 endpoint 重命名为 `/main-agent-context/recent`（#70）
- agent/apps: `terminal` capability 迁成 `TerminalApp`（#69）
- agent: `WebSearchTaskAgent` 复用主 Agent prefix，命中 prompt cache（#68）
- web: 拆 Agent 仪表盘为两个独立页面（#66）
- agent: `InvokeTool` 改成 owner-driven dispatch（#65）
- agent: 主 Agent / 子 Agent `toolChoice` 回到 `required`（#64）
- agent: 移除神游（zone_out）状态与子工具（#59）
- agent: 子 Agent / 召回 / 主 Agent 上下文摘要切换为 `auto` toolChoice（#57）
- agent-runtime: 主 Agent 切换为 `auto` toolChoice（#56）
- agent/story: 拆分 `StoryAgentHost` 为三段独立组件
- agent: 拆分 `RootAgentSession` 状态机为独立子类

### Performance

- agent/story: `StoryRecall` 异步化，主 Agent 不再为召回等待（#60）

### Fixed

- agent: `InvokeTool` 分流 App 工具与状态树工具（#63）
- agent/story: 修复 review 发现的 `BatchPreparer` 不变量降级与字段漂移

## 2026-04

### Added

- scheduler: 新增统一周期任务调度框架与历史表自动清理
- agent: 新增 `terminal` 状态节点与 `bash` 子工具

### Changed

- agent-runtime: 抽通用 `Queue` 与 `SerialExecutor` 替代 mutation 链
- agent: 抽出 root-agent 扩展并加固 `getSnapshot` 隔离
- scheduler: `llm_chat_call` 保留期 7 天 → 3 天
- app: 调整后台轮询启动时机
- app: 拆分 Agent runtime 装配
- auth: 抽取通用 OAuth 刷新调度器并对齐 Codex
- docs: README 英文化并新增中文版链接

### Fixed

- auth: 兼容 Claude Code 用量返回新增字段
- agent: 修复 `terminal cd ~/path` 解析、`saveCwd` 竞态及 `persistOutput` 重复

## 更早

更早的提交未在此文件归档；可通过 `git log` 查阅完整历史。

[Unreleased]: https://github.com/KisinTheFlame/kagami/compare/master...HEAD
