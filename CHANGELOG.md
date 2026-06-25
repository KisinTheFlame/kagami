# Changelog

本项目所有重要变更记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
本仓库目前以日期分节，未启用语义化版本号；`package.json` 中的 `version` 字段长期保持 `0.0.0`，仅为 npm 字段合法性而存在。新条目按提交时间倒序追加在 `## [Unreleased]` 下，定期归档到具体日期分节。

## [Unreleased]

### Added

- ci: 新增 GitHub Actions CI（`.github/workflows/ci.yml`），在 PR 与 master push 上跑 `build` / `typecheck` / `lint` / `format` / `test` 全套门禁，把"提交前手动跑四件套"变成强制关卡。整条门 config-free（`prisma generate` 用占位 `DATABASE_URL`、测试不读运行时 config），CI 无需伪造 `config.yaml`；Node 22 + pnpm（走 `packageManager` 字段），原生依赖（better-sqlite3 / hnswlib-node 等）按 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 编译（[#92](https://github.com/KisinTheFlame/kagami/pull/92)）
- agent: 新增 `hn` App，给小镜一个只读的 Hacker News 地点（agency 优先：进门不自动拉榜、无未读提醒，想看才看，区别于 ithome 的"推未读"节奏）。4 个 InvokeTool 子工具 `glance_hn` / `open_hn_thread` / `search_hn` / `open_hn_user`，顶层工具集不变（KV 稳定前缀）；feed 列表用官方 Firebase API、评论树与搜索用 Algolia API（搜索 / 嵌套评论树 / 用户主页都是 RSS 做不到、HN 原生的能力）；整个 App 自包含在 `agent/apps/hn`（无轮询 / 无 DB / 无 cursor，刻意不照搬 ithome 的 RSS 驱动结构）；`open_hn_thread` 按最热闹子树优先 + 限深限量 + 字符预算截断；所有 HN 文本过 `htmlToPlainText` 清洗（去标签 / 解码实体 / 软化尖括号）防上下文结构注入；onFocus 只返静态提示屏、无网络 I/O（[#86](https://github.com/KisinTheFlame/kagami/pull/86)）
- agent-runtime: 为此前零测试的核心包 `@kagami/agent-runtime` 补上 vitest 测试基建，新增 26 条不变量测试，直接测源码、不依赖构建；覆盖 Effect 解释器（`ReplaceLeadingMessages` 唯一前缀重建路径且传副本、无匹配 / Noop 收到 effect 即抛绝不静默吞）、事件队列（FIFO、一次 enqueue 唤醒全部 waiter）、串行执行器（严格串行不交错、单任务抛错隔离）、`ZodToolComponent`（非法参数永不进 `executeTyped`、业务抛错转结构化结果）；根目录 `pnpm test` 现已覆盖该包（[#87](https://github.com/KisinTheFlame/kagami/pull/87)）
- agent: 新增 `clock` App，提供 `view_time` 工具让 Agent 主动查询当前北京时间（精确到秒）；与 Wake Reminder 降频（[#77](https://github.com/KisinTheFlame/kagami/pull/77)）形成被动 + 主动的时间感知闭环（[#79](https://github.com/KisinTheFlame/kagami/pull/79)）

### Changed

- build/config: `prisma generate`（及 `pnpm build` / `typecheck`）不再依赖 `config.yaml`——`scripts/prisma.sh` 对 `generate` 子命令改用占位 `DATABASE_URL`，让纯代码生成 / 类型检查与运行时配置解耦；连库命令（`migrate` / `db push` 等）仍读真实 `server.databaseUrl`，缺失即报错不静默兜底。便于 CI / 全新 clone 在没有 `config.yaml` 时直接跑 build / typecheck（[#91](https://github.com/KisinTheFlame/kagami/pull/91)）
- agent: 顶层 `news` 模块塌缩为 `ithome` capability，消除"多源资讯"泛化。抓取 / 存储 / 轮询本体迁入 `agent/capabilities/ithome`（对标 `terminal` 范式的能力本体 + App 壳分层），App 壳保留在 `agent/apps/ithome`；删除 `source_key` 多源抽象：`IthomeNewsService`→`IthomeService`、表 `news_article` / `news_feed_cursor`→`ithome_article` / `ithome_feed_cursor`（游标退化为单行表）、事件 `news_article_ingested`→`ithome_article_ingested`、配置 `server.news.ithome`→`server.ithome`；迁移 `collapse_news_into_ithome` 以 rename + `INSERT SELECT` 保留已抓取文章与已读游标
- server: 数据库由外部 PostgreSQL + pgvector 迁移到**进程内 SQLite + hnswlib-node**，宿主机不再需要运行独立数据库。ORM 仍是 Prisma（adapter 换 `@prisma/adapter-better-sqlite3`）；schema 去掉 PG 专有类型，`EmbeddingCache.embedding` 与向量列改 `String`(JSON)；向量检索改进程内 HNSW（SQLite 为唯一事实来源、启动时重建）；metric / napcat / app-log 的原生 SQL 改写为 SQLite 方言；持久化数据统一进 `data/`（`sqlite/`、`vector/`）；重建 Prisma 迁移基线；旧 PostgreSQL 数据经一次性脚本搬迁（脚本不随仓库留存）（[#85](https://github.com/KisinTheFlame/kagami/pull/85)）
- agent: Wake Reminder 由每分钟降频为每半小时一次，同一半小时窗口（00 / 30 分桶）内的多轮 round 共享去重 key、不再重复追加；展示的时间值仍是真实触发时刻；长会话尾部 `system_reminder` 噪声减少约 30 倍，对 KV 缓存更友好（[#77](https://github.com/KisinTheFlame/kagami/pull/77)）
- build/config: `config.loader.ts` 与 `scripts/read-config.mjs` 在 git worktree 内找不到 `config.yaml` 时，自动通过 `.git` 文件解析主仓库根目录并读取其中的 `config.yaml`，让 worktree 不再需要拷贝 / symlink 配置即可跑 `pnpm db:generate` / `pnpm build`
- agent: 移除 `wait` 工具连续第 3 次调用时的 `<wait_blocked>` 短路限制；`wait` 现在总是产出 `wait_for_event`，由事件队列或最大等待时间正常恢复主循环
- llm-history: 拆分 LLM 调用历史列表 / 详情接口，`/llm-chat-call/query` 列表只返回 summary 字段，新增 `GET /llm-chat-call/:id` 详情接口；前端列表改为按选中 id 单独 fetch detail，降低列表响应体大小（[#72](https://github.com/KisinTheFlame/kagami/pull/72)）

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
