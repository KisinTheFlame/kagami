# Changelog

本项目所有重要变更记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
本仓库目前以日期分节，未启用语义化版本号；`package.json` 中的 `version` 字段长期保持 `0.0.0`，仅为 npm 字段合法性而存在。新条目按提交时间倒序追加在 `## [Unreleased]` 下，定期归档到具体日期分节。

## [Unreleased]

### Added

- agent: 新增 `clock` App，提供 `view_time` 工具让 Agent 主动查询当前北京时间（精确到秒）；与 Wake Reminder 降频（[#77](https://github.com/KisinTheFlame/kagami/pull/77)）形成被动 + 主动的时间感知闭环（[#79](https://github.com/KisinTheFlame/kagami/pull/79)）

### Changed

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
