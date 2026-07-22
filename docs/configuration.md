# 配置与数据库

Kagami 的配置读取、配置分区、SQLite 存储布局与 Prisma 迁移流程。面向 LLM agent 的最高优先级规则见 [AGENTS.md](../AGENTS.md)，代码组织见 [ARCHITECTURE.md](../ARCHITECTURE.md)。

## 配置文件

配置拆成两份，启动时由 `@kagami/config` 定位仓库根、深合并两者，再交 `packages/kernel/src/config/config.loader.ts` 的 `ConfigSchema` 校验：

- `config.yaml` — 非隐私，纳入版本控制，直接改。
- `config.secret.yaml` — 隐私（密钥 / PII），gitignore，从 `config.secret.yaml.example` 复制填写。

约定：

- `config.secret.yaml` 可覆盖任意字段（无隐私路径白名单），但**约定上只放凭据 / PII**（apiKey、bot、`napcat.listenGroupIds`、高德 key 等）。拓扑（`services.*`、`server.databaseUrl`）留在 `config.yaml`。
- 原型污染由 `@kagami/config` 深合并的 `DANGEROUS_KEYS` 兜底丢弃。
- 配置读取（repo-root 定位 + 两文件合并）统一由零依赖叶子包 `@kagami/config` 承载；kernel / gateway / oss / `scripts/read-config.mjs` 都复用它。gateway / oss 只读非隐私的 `services.*`，不需要 `config.secret.yaml`。

> **改配置 schema 是硬约束**：必须同步 `config.loader.ts`、`config.yaml`、`config.secret.yaml.example` 三处（详见 AGENTS.md「硬约束」）。

## 关键配置分区

- `server.databaseUrl`（SQLite `file:` 路径）、`server.port`
- `server.agent.contextCompactionTotalTokenThreshold`、`llmRetryBackoffMs`、`waitToolMaxWaitMs`、`notificationLeadingWindowMs`、`notificationBatchWindowMs`
- `server.agent.messaging.aiTone`（小镜发言 AI 味实时门控的权重与阈值）
- `server.ithome.pollIntervalMs`、`recentArticleLimit`、`articleMaxChars`
- `server.napcat.wsUrl`、`reconnectMs`、`requestTimeoutMs`、`listenGroupIds`、`startupContextRecentMessageCount`
- `server.llm.timeoutMs`、`authUsageRefreshIntervalMs`、`embedding`（文本向量化，LLM 网关持有、agent 经 HTTP 调用）、`codexAuth`、`claudeCodeAuth`
- `server.llm.providers.{deepseek,openai,openaiCodex,claudeCode}`
- `server.llm.usages.{agent,contextSummarizer,vision,todoSuggestionAgent,innerVoice}`
- 顶层 `services`（与 `server` 平级）：各服务监听端口与地址的唯一事实来源，`services.{agent,console,gateway,oss,browser,llm,metric,spire,pixel,napcat}.{host,port}`，所有进程读它寻址；`services.{oss,browser,llm,metric,spire,pixel,napcat}` 仅 localhost。
- `server.oss.enabled`（对象存储启用开关；地址来自 `services.oss`，整段省略 = 禁用、优雅降级）
- `server.apps.*`（App 级配置，如 `calc.precision`、`terminal.*`、`hn.*`、`amap.*`；`amap.apiKey` 为凭据，走 `config.secret.yaml`）
- `server.bot.qq`、`server.bot.creator`

## 数据库与存储布局

- 数据库为**进程内 SQLite 文件**（默认 `data/sqlite/kagami.db`），不依赖外部 PostgreSQL；ORM 仍是 Prisma，driver adapter 为 `@prisma/adapter-better-sqlite3`。
- 直接查库用 `sqlite3` CLI；库文件路径以 `config.yaml` 的 `server.databaseUrl`（`file:` 路径，运行时解析为绝对路径）为准。
- 独立服务库（epic #539「每个持库服务独立数据库」，均与主库同目录不同文件）：scheduler 独占 `data/sqlite/scheduler.db`（`services.scheduler.databaseUrl`，#493）；napcat 独占 `data/sqlite/napcat.db`（`services.napcat.databaseUrl`，#539，schema 在 `apps/napcat/prisma/`，历史数据启动时从主库一次性幂等搬迁）。metric 独占 `data/metric/metric.duckdb`（#475）、oss 独占 `data/oss/oss.db`。
- 所有持久化数据放在仓库根 `data/` 下并按类别分子目录（当前 `data/sqlite/`）；整个 `data/` 已在 `.gitignore` 中。

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

独立库服务（scheduler / napcat）的迁移走各自包内的同名脚本（同一 `scripts/prisma.sh` 参数化复用），如 `pnpm --filter @kagami/napcat db:migrate:dev -- --name <name>`；`pnpm app:deploy` 的 Step 2b/2c 会分别应用，且各只停对应单进程。

已有数据库接入 Prisma Migrate（基线）：

1. 若数据库结构已与当前 schema 对齐，先 `pnpm db:migrate:resolve -- --applied <baseline_migration_id>`。
2. 后续按标准流程使用 `db:migrate:dev` 和 `db:migrate:deploy`。

> **迁移涉及 DB schema 变更时，部署必须走无参 `pnpm app:deploy`**（会跑 `prisma migrate deploy`），不能用单服务部署（详见 AGENTS.md「部署速查」）。
