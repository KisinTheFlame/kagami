# Changelog

本项目所有重要变更记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
本仓库目前以日期分节，未启用语义化版本号；`package.json` 中的 `version` 字段长期保持 `0.0.0`，仅为 npm 字段合法性而存在。新条目按提交时间倒序追加在 `## [Unreleased]` 下，定期归档到具体日期分节。

## [Unreleased]

### Added

- agent: 新增 **Story Agent 启用开关** `server.agent.story.enabled`（默认 `true`），可整体关停后台 Story 写作 loop。关停时 index 不再 `initialize`/`run` `StoryLoopAgent`（shutdown 也不接管其 `stop`），且 `onLedgerAppended` 回调不再向 `storyEventQueue` 入队——否则 `ledger_appended` 事件会在无人消费下无界堆积。沿用既有 `recall.enabled` 同范式：与主 Agent 前缀完全无关，`search_memory` 顶层工具照旧注册、tools 列表字节不变，稳定前缀与 KV 缓存零影响（[#110](https://github.com/KisinTheFlame/kagami/pull/110)）
- napcat: QQ 接收的**所有图片对接自建 OSS**，上下文展示 resid。所有入站图片（群/私聊/历史/转发展开）都经唯一咽喉点 `analyzeImageSegment`，它本就下载图片字节喂 vision，现在一次下载同时把原图 PUT 进 `@kagami/oss` 拿 `res-N`，并在上下文渲染成 `[图片: 描述, resid: res-N]`，给小镜一个能稳定引用原图的句柄（为「图片原图直接进上下文、弃用 vision 转文本」铺路）。核心是内容寻址缓存：新增 `image_asset` 表（`file_id` = 图片内容 MD5，唯一 → `resid` + `description`），同一张图全局只下载/描述/PUT 一次，命中直接复用、连 vision 都跳过——resid 跨消息稳定、不膨胀，且消掉「每次出现都重 vision」的重复开销（净改进）。`analyzeImageSegment` 返回由 `string` 改 `{description, resid}`、消掉 `[图片:x]` 包了又拆的正则往返，resid 回填进 `segment.data.resid` 持久化、重渲染（如 open_conversation 拉历史）也稳定带 resid。新增 `OssClient`（`POST /objects`）+ `ImageAssetDao`；`server.oss` 配置可选，缺失/OSS 挂了优雅降级（resid 恒为 null、渲染退回 `[图片: 描述]`）（[#109](https://github.com/KisinTheFlame/kagami/pull/109)）
- agent-runtime: 新增**App 状态持久化能力**，把"App 自管自己的状态、跨重启保留"从各 App 手搓（如 Terminal 自带 DAO）抽成框架级通用能力。内核给 `App` 接口加可选 `exportState()/restoreState()` + 新增 `AppStateStore` 端口 / `JsonValue` 类型；`AppManager` 注入可选 store，`startupAll` 时 `load→restoreState`（先于 onStartup）、`shutdownAll` 时 `exportState→save`（先于 onShutdown、趁 App 仍活），恢复/存档失败都不阻断启动/关停，无 store 注入则整体 no-op。server 侧落一张**通用** `app_state` 表（`appId` PK / `state` Json / `updatedAt`，一张表服务所有 App）+ `PrismaAppStateStore`。首个接入方 QQ App（取舍 A：只存未读红点）——`exportState` 交出每会话 `{ unreadCount, mentioned }`（只存有未读的），`restoreState` 恢复、私聊会话按 id 现建空壳、已下架的群不复活；群/好友信息与消息原文仍从 napcat 实时重建、不入表，杜绝陈旧快照。效果：重启后"小镜欠多少没看"连续、不再清零，`open_conversation` 仍是唯一清零点。存档时机 shutdown-only（正常部署的 SIGTERM 干净关停必然落库，仅硬崩溃丢失自上次启动以来的未读，对红点量级可接受）。这条侧路与消息列表/前缀无关，对 KV 缓存中性（[#108](https://github.com/KisinTheFlame/kagami/pull/108)）
- agent: QQ 支持查看**合并转发消息**（聊天记录）。此前 `forward` 段在渲染时被丢成空字符串，小镜完全看不到群里转发的内容；现在 napcat 渲染器把它渲染成 `[forward_id: <res_id>]` 占位（无 id 退化 `[合并转发]`），并新增 QQ App 子工具 `view_forward(forward_id, offset?)` 按需调 OneBot `get_forward_msg` 展开——遵循 KV 缓存优先：不 eager 内联，大段聊天记录只作为 tool result 进尾部，`view_forward` 是 InvokeTool 子工具、顶层工具集不变。vision 复用是关键优雅点：转发里每条消息当普通私聊消息丢进**同一条 `normalize` 管线**，图片自动走和普通消息相同的 `analyzeImageSegment`、不另起 vision 路径，嵌套转发只渲染成占位不递归（想看再展开一层）。分页默认每页 50 条、`offset` 翻页，gateway 内「原始节点 + 当页结果」双缓存（TTL 10min）让翻页不重拉 `get_forward_msg`、不重烧 vision；分层与 `getRecentGroupMessages` 对齐（napcat 层出已描述好的节点、QQ App 层只拼 `<qq_forward>`，原始图片字节不进主上下文）；`get_forward_msg` 入参（`id`+`message_id`）与返回结构（`messages`/`message`、扁平/`node` 节点）做了多版本容错（[#107](https://github.com/KisinTheFlame/kagami/pull/107)）
- oss: 新增自建对象存储服务 `@kagami/oss`（独立 PM2 进程 `kagami-oss`，仅 localhost `:20005`）。业务无关的内容寻址 blob 仓库——对外不透明短 key `res-<自增 id>`（`AUTOINCREMENT` 永不复用），对内按 sha256 去重 + 引用计数，多 key 可指同一份内容、删一个不误伤共享内容。`node:http` + 裸 `better-sqlite3`（自有 `data/oss/oss.db`、零 `@kagami/*` 依赖、启动幂等建表 + WAL + 外键），blob 裸文件按 sha256 前缀分片落 `data/oss/blobs/`，文件 I/O 走异步 `fs/promises` 不阻塞事件循环。崩溃一致性：文件 I/O 在事务外、库为唯一事实来源，崩溃只留无害孤儿、启动 `sweepOrphans` 回收；写操作（put/delete）走进程内写锁串行化，消除并发场景下"delete 的提交后 unlink 删掉并发 put 刚重建文件"的数据竞态；GET/HEAD 回放上传方 Content-Type 时强制 `nosniff` + `attachment` 防内容嗅探。仓库根锚点复刻 server 的 config.yaml 定位法，保证 data 落仓库根而非 PM2 cwd。本轮只搭服务、不接 Agent（后续才把 QQ 图片原图直接喂进上下文，替代 vision 转文本）。经 office-hours 设计 + plan-eng-review 评审 + 双模型对抗式评审
- ci: 新增 GitHub Actions CI（`.github/workflows/ci.yml`），在 PR 与 master push 上跑 `build` / `typecheck` / `lint` / `format` / `test` 全套门禁，把"提交前手动跑四件套"变成强制关卡。整条门 config-free（`prisma generate` 用占位 `DATABASE_URL`、测试不读运行时 config），CI 无需伪造 `config.yaml`；Node 22 + pnpm（走 `packageManager` 字段），原生依赖（better-sqlite3 / hnswlib-node 等）按 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 编译（[#92](https://github.com/KisinTheFlame/kagami/pull/92)）
- agent: 新增 `hn` App，给小镜一个只读的 Hacker News 地点（agency 优先：进门不自动拉榜、无未读提醒，想看才看，区别于 ithome 的"推未读"节奏）。4 个 InvokeTool 子工具 `glance_hn` / `open_hn_thread` / `search_hn` / `open_hn_user`，顶层工具集不变（KV 稳定前缀）；feed 列表用官方 Firebase API、评论树与搜索用 Algolia API（搜索 / 嵌套评论树 / 用户主页都是 RSS 做不到、HN 原生的能力）；整个 App 自包含在 `agent/apps/hn`（无轮询 / 无 DB / 无 cursor，刻意不照搬 ithome 的 RSS 驱动结构）；`open_hn_thread` 按最热闹子树优先 + 限深限量 + 字符预算截断；所有 HN 文本过 `htmlToPlainText` 清洗（去标签 / 解码实体 / 软化尖括号）防上下文结构注入；onFocus 只返静态提示屏、无网络 I/O（[#86](https://github.com/KisinTheFlame/kagami/pull/86)）
- agent-runtime: 为此前零测试的核心包 `@kagami/agent-runtime` 补上 vitest 测试基建，新增 26 条不变量测试，直接测源码、不依赖构建；覆盖 Effect 解释器（`ReplaceLeadingMessages` 唯一前缀重建路径且传副本、无匹配 / Noop 收到 effect 即抛绝不静默吞）、事件队列（FIFO、一次 enqueue 唤醒全部 waiter）、串行执行器（严格串行不交错、单任务抛错隔离）、`ZodToolComponent`（非法参数永不进 `executeTyped`、业务抛错转结构化结果）；根目录 `pnpm test` 现已覆盖该包（[#87](https://github.com/KisinTheFlame/kagami/pull/87)）
- agent: 新增 `clock` App，提供 `view_time` 工具让 Agent 主动查询当前北京时间（精确到秒）；与 Wake Reminder 降频（[#77](https://github.com/KisinTheFlame/kagami/pull/77)）形成被动 + 主动的时间感知闭环（[#79](https://github.com/KisinTheFlame/kagami/pull/79)）

### Changed

- build/lint: ESLint 开启类型感知 linting（`typescript-eslint` `recommendedTypeChecked` + `projectService`，仅作用于各包 src，测试 / 配置文件不进 scope），抓 `no-floating-promises`（现状 0）/ `no-misused-promises` / `no-unsafe-*` / `switch` 穷尽 / `base-to-string` 等只有类型信息才能发现的问题。仅关闭 `require-await`（满足接口契约的 async，留着只有噪声）；`unbound-method` 的依赖注入解构误报改用**代码**消除（OAuth 工厂参数改 `deps.` 直接调用、依赖映射类型用箭头属性语法），不靠关规则；`no-unsafe-*` 暂设 `warn` 做棘轮（可见不阻塞，后续逐步收紧）；首轮高价值违例（冗余 union、`base-to-string`、模板表达式、回调 handler 改显式 `void` fire-and-forget 而非 inline disable 等）一并修掉（[#95](https://github.com/KisinTheFlame/kagami/pull/95)、[#96](https://github.com/KisinTheFlame/kagami/pull/96)）
- build/config: `prisma generate`（及 `pnpm build` / `typecheck`）不再依赖 `config.yaml`——`scripts/prisma.sh` 对 `generate` 子命令改用占位 `DATABASE_URL`，让纯代码生成 / 类型检查与运行时配置解耦；连库命令（`migrate` / `db push` 等）仍读真实 `server.databaseUrl`，缺失即报错不静默兜底。便于 CI / 全新 clone 在没有 `config.yaml` 时直接跑 build / typecheck（[#91](https://github.com/KisinTheFlame/kagami/pull/91)）
- agent: 顶层 `news` 模块塌缩为 `ithome` capability，消除"多源资讯"泛化。抓取 / 存储 / 轮询本体迁入 `agent/capabilities/ithome`（对标 `terminal` 范式的能力本体 + App 壳分层），App 壳保留在 `agent/apps/ithome`；删除 `source_key` 多源抽象：`IthomeNewsService`→`IthomeService`、表 `news_article` / `news_feed_cursor`→`ithome_article` / `ithome_feed_cursor`（游标退化为单行表）、事件 `news_article_ingested`→`ithome_article_ingested`、配置 `server.news.ithome`→`server.ithome`；迁移 `collapse_news_into_ithome` 以 rename + `INSERT SELECT` 保留已抓取文章与已读游标
- server: 数据库由外部 PostgreSQL + pgvector 迁移到**进程内 SQLite + hnswlib-node**，宿主机不再需要运行独立数据库。ORM 仍是 Prisma（adapter 换 `@prisma/adapter-better-sqlite3`）；schema 去掉 PG 专有类型，`EmbeddingCache.embedding` 与向量列改 `String`(JSON)；向量检索改进程内 HNSW（SQLite 为唯一事实来源、启动时重建）；metric / napcat / app-log 的原生 SQL 改写为 SQLite 方言；持久化数据统一进 `data/`（`sqlite/`、`vector/`）；重建 Prisma 迁移基线；旧 PostgreSQL 数据经一次性脚本搬迁（脚本不随仓库留存）（[#85](https://github.com/KisinTheFlame/kagami/pull/85)）
- agent: Wake Reminder 由每分钟降频为每半小时一次，同一半小时窗口（00 / 30 分桶）内的多轮 round 共享去重 key、不再重复追加；展示的时间值仍是真实触发时刻；长会话尾部 `system_reminder` 噪声减少约 30 倍，对 KV 缓存更友好（[#77](https://github.com/KisinTheFlame/kagami/pull/77)）
- build/config: `config.loader.ts` 与 `scripts/read-config.mjs` 在 git worktree 内找不到 `config.yaml` 时，自动通过 `.git` 文件解析主仓库根目录并读取其中的 `config.yaml`，让 worktree 不再需要拷贝 / symlink 配置即可跑 `pnpm db:generate` / `pnpm build`
- agent: 移除 `wait` 工具连续第 3 次调用时的 `<wait_blocked>` 短路限制；`wait` 现在总是产出 `wait_for_event`，由事件队列或最大等待时间正常恢复主循环
- llm-history: 拆分 LLM 调用历史列表 / 详情接口，`/llm-chat-call/query` 列表只返回 summary 字段，新增 `GET /llm-chat-call/:id` 详情接口；前端列表改为按选中 id 单独 fetch detail，降低列表响应体大小（[#72](https://github.com/KisinTheFlame/kagami/pull/72)）

### Fixed

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
