# 配置与数据库

Kagami 的配置读取、配置分区、SQLite 存储布局与 Prisma 迁移流程。面向 LLM agent 的最高优先级规则见 [AGENTS.md](../AGENTS.md)，代码组织见 [ARCHITECTURE.md](../ARCHITECTURE.md)。

## 配置文件

配置拆成两份，启动时由 `@kagami/config` 定位仓库根、深合并两者，再交 `packages/kernel/src/config/config.loader.ts` 的 `ConfigSchema` 校验：

- `config.yaml` — 非隐私，纳入版本控制，直接改。
- `config.secret.yaml` — 隐私（密钥 / PII），gitignore，从 `config.secret.yaml.example` 复制填写。

约定：

- `config.secret.yaml` 可覆盖任意字段（无隐私路径白名单），但**约定上只放凭据 / PII**（apiKey、bot、`napcat.listenGroupIds`、浏览器凭据、高德 key 等）。拓扑（`services.*`、`server.databaseUrl`）留在 `config.yaml`。
- 原型污染由 `@kagami/config` 深合并的 `DANGEROUS_KEYS` 兜底丢弃。
- 配置读取（repo-root 定位 + 两文件合并）统一由零依赖叶子包 `@kagami/config` 承载；kernel / gateway / oss / `scripts/read-config.mjs` 都复用它。gateway / oss 只读非隐私的 `services.*`，不需要 `config.secret.yaml`。

> **改配置 schema 是硬约束**：必须同步 `config.loader.ts`、`config.yaml`、`config.secret.yaml.example` 三处（详见 AGENTS.md「硬约束」）。

## 关键配置分区

- `server.databaseUrl`（SQLite `file:` 路径）、`server.port`
- `server.agent.contextCompactionTotalTokenThreshold`、`llmRetryBackoffMs`、`waitToolMaxWaitMs`、`notificationLeadingWindowMs`、`notificationBatchWindowMs`
- `server.agent.story.enabled`、`batchSize`、`idleFlushMs`、`memory.embedding`、`memory.vectorIndexPath`、`memory.retrieval`、`recall.topK`、`recall.scoreThreshold`
- `server.agent.messaging.aiTone`（小镜发言 AI 味实时门控的权重与阈值）
- `server.ithome.pollIntervalMs`、`recentArticleLimit`、`articleMaxChars`
- `server.napcat.wsUrl`、`reconnectMs`、`requestTimeoutMs`、`listenGroupIds`、`startupContextRecentMessageCount`
- `server.llm.timeoutMs`、`authUsageRefreshIntervalMs`、`codexAuth`、`claudeCodeAuth`
- `server.llm.providers.{deepseek,openai,openaiCodex,claudeCode}`
- `server.llm.usages.{agent,storyAgent,contextSummarizer,vision,webSearchAgent}`
- 顶层 `services`（与 `server` 平级）：各服务监听端口与地址的唯一事实来源，`services.{agent,console,gateway,oss,browser,llm}.{host,port}`，所有进程读它寻址；`services.browser` / `services.llm` 仅 localhost。
- `server.oss.enabled`（对象存储启用开关；地址来自 `services.oss`，整段省略 = 禁用、优雅降级）
- `server.apps.*`（App 级配置，如 `calc.precision`、`terminal.*`、`hn.*`、`amap.*`；`amap.apiKey` 为凭据，走 `config.secret.yaml`）
- `server.tavily.apiKey`、`server.bot.qq`、`server.bot.creator`

> 历史遗留：早期的 `server.rag.*` 已迁移到 `server.agent.story.memory.*`，`config.yaml` 中不应再有独立的 `server.rag` 分区。

## 数据库与存储布局

- 数据库为**进程内 SQLite 文件**（默认 `data/sqlite/kagami.db`），不依赖外部 PostgreSQL；ORM 仍是 Prisma，driver adapter 为 `@prisma/adapter-better-sqlite3`。
- 直接查库用 `sqlite3` CLI；库文件路径以 `config.yaml` 的 `server.databaseUrl`（`file:` 路径，运行时解析为绝对路径）为准。
- Story 向量记忆用**进程内 HNSW 索引（hnswlib-node）**：向量以 JSON 字符串存于 `story_memory_document.embedding`（SQLite 为唯一事实来源），索引启动时从 SQLite 重建、并持久化派生快照到 `data/vector/story-memory.hnsw`。
- 所有持久化数据放在仓库根 `data/` 下并按类别分子目录（`data/sqlite/`、`data/vector/`）；整个 `data/` 已在 `.gitignore` 中。

## Prisma 迁移

```bash
pnpm db:migrate:dev -- --name <migration_name> # 生成迁移（脚本自动补 --create-only）
pnpm db:migrate:deploy                          # 部署 / 上线时应用已有迁移
pnpm db:migrate:status                          # 查看迁移状态
pnpm db:migrate:reset                           # 重置数据库（危险）
pnpm db:migrate:resolve -- --applied <migration_id> # 标记迁移已应用
```

变更流程：

1. 修改 `packages/persistence/prisma/schema.prisma`。
2. 在仓库根执行 `pnpm db:migrate:dev -- --name <migration_name>`。
3. 提交 schema 变更和 `packages/persistence/prisma/migrations/*`。
4. 在目标环境执行 `pnpm db:migrate:deploy`，或通过 `pnpm app:deploy` 一并完成。

已有数据库接入 Prisma Migrate（基线）：

1. 若数据库结构已与当前 schema 对齐，先 `pnpm db:migrate:resolve -- --applied <baseline_migration_id>`。
2. 后续按标准流程使用 `db:migrate:dev` 和 `db:migrate:deploy`。

> **迁移涉及 DB schema 变更时，部署必须走无参 `pnpm app:deploy`**（会跑 `prisma migrate deploy`），不能用单服务部署（详见 AGENTS.md「部署速查」）。
