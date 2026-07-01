# 指示

你的一切交流和汇报，使用简体中文。

## 项目理念（必读）

Kagami **不是一个 QQ 群聊机器人**，而是一个**拥有自己生活的 Agent**。

群聊只是他生活的一部分，就像一个人不会把自己定义为"聊天的人"。只要给他足够多的能力（capability），他就可以像一个真正的人那样，去读新闻、去记住发生过的事、去主动做自己感兴趣的事。项目的核心概念是 **Agent as a life**：

- QQ 群消息只是他接收到的一种事件，与 RSS 轮询、定时任务、系统通知在架构上是平级的"生活输入"。
- 他有自己的记忆（Story / RAG）、自己的兴趣（IThome 轮询、主动发言）、自己的节奏（事件队列、空闲时刻的后台动作）。
- 新增 capability 时，应该问自己："这是在给 Agent 的生活加一种新的存在方式吗？"，而不是"这是在给聊天机器人加一个功能吗？"。
- 不要把 NapCat、群聊相关的概念泄漏到 `agent/runtime` 的核心抽象里。它只是众多外部事件源之一。

任何架构决策、模块划分、命名，如果与这个定位冲突，定位优先。

## 开发原则：KV 缓存命中率优先

开发 Agent 的新功能时，**必须非常非常重视 KV 缓存能否命中**。provider 侧 KV cache 的命中与否直接决定每轮推理的延迟和成本，一次前缀漂移会让整段历史从零换入。这条原则的优先级等同于项目理念，任何新 capability / operation / tool 在设计阶段就要想清楚"它会不会让已有会话的前缀失效"。

### 核心模型：稳定前缀 + 易变尾部 + 计划性重建

把 Agent 的 message 列表想象成三段：

1. **稳定前缀**：system prompt、工具定义、历史对话。只追加、不修改。
2. **易变尾部**：当轮新事件、召回注入、工具调用结果。可以变，但只影响最后一段。
3. **计划性重建**：只有上下文压缩这类明确的、罕见的动作才允许整体 `replaceMessages`，一次性把旧前缀换成更短的新前缀，从此作为新的稳定前缀继续生长。

对应到运行时，`AgentContext` 只暴露两个会改动 message 列表的操作：`appendMessages`（保留前缀）与 `replaceMessages`（明确破坏并重建前缀）。新功能如果既不是追加也不是压缩，就要警惕。

### 工具组织：InvokeTool 是顶层工具集的稳定壳

`InvokeTool` 是 Kagami 工具系统不可动摇的结构性支柱。它本身是一个 meta-tool，只接 `name` 和 `args` 两个参数，但内部承载所有 capability / App 的具体工具。这样设计的关键收益是：**LLM API 的 tools 列表始终只有少数几个顶层工具**（`enter` / `back-to-portal` / `switch` / `wait` / `invoke` / `search_web` / `search_memory` / `help` 这一类结构 / 能力级元工具），从启动到关停不变，不论项目里有多少 capability、多少 App 都不影响。

如果不通过 InvokeTool，每加一个工具都要在 LLM 的 tools 参数里多一个 entry，这是稳定前缀的一部分，意味着每加一个新工具都会让所有进行中的会话从零换入。InvokeTool 把"加新东西就触发一次前缀失效"的代价从"每加一个工具一次"压缩到"几乎不会发生"。

具体工具的能力 / 参数 / 用法有两种披露方式：

- **早期方案**：把全部子工具的文档塞进 InvokeTool 自己的 description 里。前缀里有完整子工具索引，但加新子工具会改 InvokeTool description 一次（仍然比加顶层工具便宜）。
- **渐进式披露**（App 框架的目标）：前缀里几乎不写子工具信息，Kagami 通过 `enter(<appId>)` + `help` 两个动作在运行时按需探索能做什么。每个 App 的工具只在 Kagami 真正"进入"该 App 时通过 help 询问才会被披露。前缀对 App 数量完全不敏感。

写新 capability 或 App 时记住：**任何想暴露给 Agent 的能力，第一反应都应该是"做成 InvokeTool 的子工具"，而不是"加一个顶层工具"**。新增顶层工具需要明确的设计理由：它必须是结构性的元能力（像 enter / help 这种调度 / 导航工具），而不是某个具体业务能力。

### 现有实现里的三个范例

写新 capability 前，先读这三处代码，它们是 KV 缓存友好的参考实现：

**1. Web Search —— 子 Agent 隔离，避免污染主上下文**

`capabilities/web-search/` 的做法是开一个独立的 `WebSearchTaskAgent`，通过 `structuredClone` 复制主 Agent 的 snapshot，在隔离上下文里跑多轮搜索、读网页、整理，然后只把**最终摘要字符串**作为 tool result 返回给主 Agent。原始搜索结果、网页正文、中间推理全都留在子 Agent 的上下文里用完即弃，主 Agent 的前缀完全不受影响。

**教训**：任何会产生大量中间 token 的能力（搜索、抓网页、读长文件、跑代码），都应该封装成 TaskAgent 或 Operation，只向主 Agent 回传摘要。不要让原始素材进主 Agent 的消息列表。

**2. Story Recall —— 追加到尾部，而非插入前缀**

`capabilities/story/runtime/story-recall.extension.ts` 在 `onBeforeRound` 阶段通过 `context.host.appendMessages([recallMessage])` 把召回结果**追加到消息尾部**，包在 `<story_recall>` 标签里。它绝不把召回内容塞到 system prompt 或历史中段。配合 `lastRecallMessageCount` 去重，只在真的有新消息时才产出新召回，避免空转写入。压缩发生时，扩展通过 `onContextCompacted()` 清空自身的注入集合，跟着新前缀重新开始。

**教训**：想给 Agent "喂"外部信息（召回、新闻、提醒、周期状态），一律**往尾部 append**。永远不要为了"让它更显眼"而把动态内容插到 system prompt 或前缀里——那会让整个会话每轮都从零换入。

**3. Context Summarizer —— 唯一允许破坏前缀的地方**

`RootAgentRuntime.compactContextIfNeeded` 在 token 超阈值时触发压缩：计算保留边界（最近 10% 消息，扩展到 tool-call 边界），对前半部分生成摘要，然后用 `replaceMessages([summaryMessage, ...messagesToKeep])` **一次性**重建整条消息列表。这一次重建会彻底失效旧的 KV cache，但换来的是一个更短、更稳定的新前缀，后续多轮共享。压缩后通过 `notifyContextCompacted()` 通知所有扩展重置自身临时状态，让它们配合新前缀继续工作。

**教训**：`replaceMessages` 是一次"受控的昂贵操作"。除了上下文压缩这种明确场景，不要再引入第二种会调用它的路径。任何新功能想"改写一下历史"，都应该先问：能不能改成 append？

### 具体红线

- **不要**在 system prompt 或稳定前缀里写入时间戳、随机 ID、轮次计数、当前时间、会变的运行时状态。这些属于尾部或工具结果。
- **不要**在一轮内反复改写 system prompt 或工具描述来"传递状态"。状态走消息尾部或工具参数。
- **不要**为了排版/美观调整历史消息的序列化格式、字段顺序、JSON 键顺序——同一会话内这类改动会让已命中的前缀全部报废。
- **不要**给主 Agent 添加会返回大块原始数据的工具。大数据先进子 Agent / Operation，再以摘要回传。
- **不要**在压缩之外的地方调用 `replaceMessages`。
- **system prompt 和工具集的改动要集中提交**：每次改动都会让所有在飞会话的前缀失效一次，小步高频修改是最糟糕的模式。
- **进上下文的散文一律走模板，禁止在 TS 里内联字面量**：任何最终会进 LLM 上下文的成句文案（system prompt、各类 reminder、`<notification>` / `<story_recall>` / `<async_tool_result>` 等伪标签内容、通知 draft 的渲染文本）都必须落在 `apps/agent/static/` 下的 `.hbs` 模板，经 `renderServerStaticTemplate(import.meta.url, ...)` 渲染。TS 侧只负责算 view-model（计数、数组、布尔 flag、预格式化好的日期/截断文本），不写成句文案。这样调小镜的语气只改 `static/` 一棵树、不碰代码，也让"所有会进上下文的文本"始终收在同一处可审。**例外（留 TS 常量）**：分组 key / 结构标识（如 `"QQ"`、`"IT之家"`、`"待办"`）这类不是语气的标识符；以及工具 description 与工具 result 的 error/status note（前者绑 param schema 属渐进式披露垂直切片，后者进易变尾部且与控制流交织，见 `TODOS.md`）。
- Review 新 capability / operation / tool 时，把"会不会破坏 KV 缓存命中"以及"进上下文的散文是否走了模板"作为显式检查项写进自检清单。

## 项目定位

Kagami 是一个基于 pnpm workspace 的全栈 TypeScript Monorepo，当前包含十二个工作空间包：

- `apps/agent`：Fastify 后端服务（`@kagami/agent`）
- `apps/console`：管理台后端独立进程（`@kagami/console`，服务前端纯 DB 查询，经 @kagami/persistence 共享 DAO 直读 SQLite）
- `apps/web`：React 前端管理台（`@kagami/web`）
- `apps/gateway`：前门网关进程（`@kagami/gateway`，独立进程、零 `@kagami/*` 依赖；托管 `apps/web/dist` 静态资源 + `/api/*` 反向代理分流到 console/agent）
- `apps/oss`：自建对象存储服务（`@kagami/oss`，独立进程、零 `@kagami/*` 依赖）
- `apps/browser`：独立浏览器进程（`@kagami/browser`，server-core-based Fastify、仅绑 127.0.0.1；持有 CloakBrowser 与凭据注入，agent 经 HTTP 客户端驱动。拆成独立进程让 agent 重启不杀浏览器）
- `packages/agent-runtime`：通用 Agent / App 框架内核（`@kagami/agent-runtime`）
- `packages/llm`：前后端 / 内核共用的 LLM 消息与工具类型契约（`@kagami/llm`）
- `packages/kernel`：后端纯净基础设施内核（config、logger、common 契约与错误、`isRecord` 等纯工具，`@kagami/kernel`，无 fastify / 无 Prisma / 无 better-sqlite3，可被不碰 DB / 不提供 HTTP 的服务复用）
- `packages/http`：HTTP 路由辅助（`route.helper`，`@kagami/http`，仅依赖 fastify + zod，零 `@kagami/*` 依赖；不提供 HTTP 接口的服务无需引入）
- `packages/persistence`：持久化基础设施（Prisma 客户端与 generated client、db、所有业务 DAO、Prisma JSON helper，`@kagami/persistence`，依赖 `@kagami/kernel` + Prisma + better-sqlite3）
- `packages/shared`：前后端共享的 Schema 与工具（`@kagami/shared`）

workspace 定义位于仓库根目录 `pnpm-workspace.yaml`，当前仅包含 `apps/*` 与 `packages/*`。

## 硬约束

- 除非任务明确要求，否则一切交流与汇报统一使用简体中文。
- 除非任务明确要求，否则默认在仓库根目录执行命令。
- 数据库相关命令统一读取仓库根目录 `config.yaml` 中的 `server.databaseUrl`。
- 修改配置 schema 时，必须同步更新：
  - `packages/kernel/src/config/config.loader.ts`
  - `config.yaml`（非隐私，纳入版本控制）
  - `config.secret.yaml.example`（隐私模板；新增隐私字段还要同步 `config.loader.ts` 里的 `CONFIG_SECRET_WHITELIST`）
- 提交前至少执行：

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm format
```

需保证全部成功。

## 常用命令

### 根目录命令

```bash
pnpm build # 按 workspace 依赖拓扑构建所有包
pnpm typecheck # 对所有包执行 TypeScript 类型检查
pnpm test # 运行声明了 test 脚本的包
pnpm lint # ESLint 检查
pnpm lint:fix # ESLint 自动修复
pnpm format # Prettier 格式检查
pnpm format:write # Prettier 自动格式化
pnpm app:deploy # 无参=全量：build -> prisma migrate deploy -> PM2 reload/startOrReload(全部) -> pm2 save
pnpm app:deploy <agent|console|gateway|oss|browser> # 单服务：只重建并重载该服务，不跑迁移、不动其它进程
```

### 单包命令

```bash
pnpm --filter @kagami/agent <script>
pnpm --filter @kagami/web <script>
pnpm --filter @kagami/agent-runtime <script>
pnpm --filter @kagami/shared <script>
```

### 当前开发现状

- 当前仓库没有统一的根目录 `pnpm dev` 脚本。
- `apps/agent` 当前提供 `build`、`typecheck`、`test`、`test:watch`、`db:*` 脚本。
- `apps/web` 当前提供 `build`、`typecheck` 脚本。
- `packages/agent-runtime` 当前提供 `build`、`typecheck`、`test`、`test:watch` 脚本。
- `packages/shared` 当前提供 `build`、`typecheck` 脚本。
- 因此前后端联调时，需要按实际情况分别启动或补充本地开发脚本，不要假设仓库已经内置一键 dev 流程。

### 测试

```bash
pnpm test # 运行整个 Monorepo 中声明了 test 脚本的包
pnpm --filter @kagami/agent test # 运行后端 Vitest
pnpm --filter @kagami/agent test:watch # 以后端 watch 模式运行测试
```

补充说明：

- 当前 `@kagami/agent`、`@kagami/agent-runtime`、`@kagami/oss` 声明了测试脚本（agent-runtime 用 vitest 直接测源码，覆盖 Effect / 队列 / 串行执行器 / 工具组件的不变量）。

## 数据库与配置

- 数据库为**进程内 SQLite 文件**（默认 `data/sqlite/kagami.db`），不再依赖外部 PostgreSQL 服务；ORM 仍是 Prisma，driver adapter 为 `@prisma/adapter-better-sqlite3`。
- 直接查库可使用 `sqlite3` CLI；库文件路径以仓库根目录 `config.yaml` 中的 `server.databaseUrl`（`file:` 路径，运行时解析为绝对路径）为准。
- Story 向量记忆不再用 pgvector，改为**进程内 HNSW 索引（hnswlib-node）**：向量以 JSON 字符串存于 `story_memory_document.embedding`（SQLite 为唯一事实来源），HNSW 索引在启动时从 SQLite 重建、并持久化派生快照到 `data/vector/story-memory.hnsw`。
- 所有持久化数据统一放在仓库根 `data/` 目录下并按类别分子目录（`data/sqlite/`、`data/vector/`）；整个 `data/` 已在 `.gitignore` 中。

### 数据库迁移

```bash
pnpm db:migrate:dev -- --name <migration_name> # 生成迁移（脚本会自动补上 --create-only）
pnpm db:migrate:deploy # 部署/上线时应用已有迁移
pnpm db:migrate:status # 查看迁移状态
pnpm db:migrate:reset # 重置数据库（危险）
pnpm db:migrate:resolve -- --applied <migration_id> # 标记迁移已应用
```

数据库变更流程：

1. 修改 `packages/persistence/prisma/schema.prisma`。
2. 在仓库根目录执行 `pnpm db:migrate:dev -- --name <migration_name>`。
3. 提交 schema 变更和 `packages/persistence/prisma/migrations/*`。
4. 在目标环境执行 `pnpm db:migrate:deploy`，或通过 `pnpm app:deploy` 一并完成。

已有数据库接入 Prisma Migrate（基线）：

1. 如果数据库结构已与当前 schema 对齐，先执行 `pnpm db:migrate:resolve -- --applied <baseline_migration_id>`。
2. 后续再按标准流程使用 `db:migrate:dev` 和 `db:migrate:deploy`。

### 配置文件

- 配置拆成两份：`config.yaml`（非隐私，纳入版本控制，直接改）+ `config.secret.yaml`（隐私：密钥/PII，gitignore，从 `config.secret.yaml.example` 复制填写）。启动时由 `@kagami/config` 定位并深合并两者，再交 `packages/kernel/src/config/config.loader.ts` 的 `ConfigSchema` 校验。
- `config.secret.yaml` 只允许出现 `config.loader.ts` 里 `CONFIG_SECRET_WHITELIST` 白名单内的隐私路径（apiKey / bot / napcat.listenGroupIds / 浏览器凭据）；越界键（如 `services.*`）启动报错。
- 配置读取（repo-root 定位 + 两文件合并）统一由零依赖叶子包 `@kagami/config` 承载；kernel / gateway / oss / `scripts/read-config.mjs` 都复用它。gateway / oss 只读非隐私的 `services.*`，不需要 `config.secret.yaml`。
- 关键配置分区包括：
  - `server.databaseUrl`（SQLite `file:` 路径）、`server.port`
  - `server.agent.contextCompactionTotalTokenThreshold`、`llmRetryBackoffMs`、`waitToolMaxWaitMs`、`notificationLeadingWindowMs`、`notificationBatchWindowMs`
  - `server.agent.story.enabled`、`batchSize`、`idleFlushMs`、`memory.embedding`、`memory.vectorIndexPath`、`memory.retrieval`、`recall.topK`、`recall.scoreThreshold`
  - `server.agent.messaging.aiTone`（小镜发言 AI 味实时门控的权重与阈值）
  - `server.ithome.pollIntervalMs`、`recentArticleLimit`、`articleMaxChars`
  - `server.napcat.wsUrl`、`server.napcat.reconnectMs`、`server.napcat.requestTimeoutMs`
  - `server.napcat.listenGroupIds`、`server.napcat.startupContextRecentMessageCount`
  - `server.llm.timeoutMs`、`authUsageRefreshIntervalMs`
  - `server.llm.codexAuth`、`server.llm.claudeCodeAuth`
  - `server.llm.providers.deepseek`、`server.llm.providers.openai`、`server.llm.providers.openaiCodex`、`server.llm.providers.claudeCode`
  - `server.llm.usages.agent`、`storyAgent`、`contextSummarizer`、`vision`、`webSearchAgent`
  - 顶层 `services`（与 `server` 平级）：各服务监听端口与地址的唯一事实来源，`services.{agent,console,gateway,oss,browser}.{host,port}`，所有进程读它寻址（见 issue #162）；`services.browser` 仅 localhost（见 issue #173）
  - `server.oss.enabled`（自建对象存储启用开关；地址来自 `services.oss`，整段省略=禁用、优雅降级）
  - `server.apps.*`（App 级配置，如 `calc.precision`、`terminal.*`、`hn.*`）
  - `server.tavily.apiKey`
  - `server.bot.qq`、`server.bot.creator`

> 历史遗留说明：早期配置中的 `server.rag.*` 已经迁移到 `server.agent.story.memory.*`，`config.yaml` 中不应再存在独立的 `server.rag` 分区。

## 代码规范

### Prettier

- 双引号（`singleQuote: false`）
- 分号（`semi: true`）
- 缩进 2 空格（`tabWidth: 2`，`useTabs: false`）
- 行宽 100 字符
- 尾逗号（`trailingComma: "all"`）

### TypeScript

- 所有包继承 `tsconfig.base.json`，开启 `strict: true`。
- 后端与 shared 使用 `module: NodeNext`、`moduleResolution: NodeNext`。
- 前端应用使用 `moduleResolution: Bundler`。
- 前端额外开启 `noUnusedLocals` 与 `noUnusedParameters`。

路径别名现状：

- 后端 `apps/agent/tsconfig.json` 为 `@kagami/shared/*` 配置了源码路径映射。
- 后端 `apps/agent/tsconfig.json` 也为 `@kagami/agent-runtime` 和 `@kagami/agent-runtime/*` 配置了源码路径映射。
- 前端显式配置了 `@/* -> apps/web/src/*`。
- 不要假设前端也单独声明了 `@kagami/shared` 的源码路径别名；它当前通过 workspace 依赖使用该包。

### ESLint

- 忽略 `dist/`、`build/`、`node_modules/`、`prisma/generated/`
- 前端应用启用 `react-hooks` 和 `react-refresh` 规则

### Shared 包约定

- `packages/shared` 主要承载前后端共用的 Zod Schema、响应模型和工具函数。
- `packages/shared` 不再提供根入口 barrel；统一使用显式子路径导入，例如 `@kagami/shared/schemas/health`、`@kagami/shared/utils`。
- 当前 shared 包不会导出 `z`；如果需要直接定义 Zod schema，按现状应从 `zod` 导入。
- 新代码不要在项目内新增 re-export/barrel 文件，优先直接导入真实实现路径或包的显式子路径。

### Agent Runtime 包约定

- `packages/agent-runtime` 只承载通用 Agent Runtime 内核，不承载 Kagami 项目语义。
- 允许放入该包的内容包括：`TaskAgent`、`BaseTaskAgent`、`Operation`、`Tool` 抽象、`App` / `AppManager` / `AppStateStore` 框架、`ToolCatalog`、`ToolSet`、`ToolExecutor` 等纯运行时能力。
- 不要把 NapCat 事件模型、Kagami system prompt、`RootAgentRuntime`、具体 capability 实现放入该包。
- `apps/agent` 中如果需要使用这些通用能力，优先直接从 `@kagami/agent-runtime` 导入，而不是继续依赖 server 内部的兼容 re-export 路径。

## 设计系统

任何视觉 / UI 改动前，先读仓库根目录 `DESIGN.md`。字体、颜色、间距、布局、美术方向全部定义在那里，未经用户明确批准不要偏离。

- 方向代号：**晒褪了色的蒙德里安 / The Painted Ledger**（蒙德里安骨架 + 文艺复兴 / 印象派颜料色）。
- 前端**不再使用 shadcn 的有样式组件与默认 slate 主题**；保留 Radix 无样式行为基元（焦点 / 键盘可访问性），其余 class 体系与组件外观自定义。
- 配色铁律：颜色是配给不是涂抹，90% 中性 + 暖近黑，饱和色只落在「活着 / 有语义」的数据上（红=错/主动发言、蓝=LLM/context、黄=scheduler/等待、绿=Story/记忆、茜=高成本）。
- QA / Review 时，发现不符合 `DESIGN.md` 的代码要标出来。

## 架构概览

### 后端（`@kagami/agent`）

后端当前已经重组为“扁平模块 + 模块内分层”的结构，顶级目录直接位于 `apps/agent/src/<module>`，以模块 DAG 为主，而不是旧的全局 `service / handler / dao / agents` 横向分层。

当前主要模块如下（非穷举）：

- `common/`：无业务语义的公共能力与跨模块契约，当前包括 `contracts/`、`errors/`、`http/`、`runtime/`
- `config/`：配置 schema、配置加载、运行时配置管理
- `db/`：Prisma 客户端、数据库连接与事务基础设施
- `logger/`：日志 runtime、serializer、sink、日志 DAO
- `auth/`：OAuth、回调服务、secret store、usage cache、usage trend 与统一认证 HTTP 接口
- `llm/`：LLM provider、chat client、embedding、playground、相关 DAO
- `napcat/`：NapCat 协议适配（gateway transport、入站归一化、图片分析、持久化写入）；网关实例由 QQ App 持有，只是 Agent 的一种事件源
- `metric/`：运行时指标与可视化数据接口
- `scheduler/`：后台定时任务（auth 刷新、IThome 轮询、数据保留清理等）
- `oss/`：server 侧对象存储 HTTP 客户端，把图片 PUT 进自建 `apps/oss`
- `agent/`：Kagami 的 Agent 业务层，负责手机 OS 运行时（Portal / App / NotificationCenter）、capabilities、上下文压缩、故事记忆、RAG 等
- `ops/`：后台查询与观测接口，例如 app log、LLM history、embedding cache、Story、main-agent-context、NapCat history
- `app/`：最高层运行时装配，负责模块 wiring、Fastify 路由注册、健康检查、Agent / Story / 网关生命周期编排

模块内优先按垂直分层组织，常见层次包括：

- `domain/`：实体、值对象、模块内 port、纯规则
- `application/`：use case、workflow、query/command service
- `infra/`：Prisma/HTTP/外部系统适配实现
- `http/`：Fastify handler 与路由注册

补充说明：

- 不是每个模块都会把 `domain / application / infra / http` 四层补齐，是否拆层以实际复杂度为准。
- 模块之间按 DAG 依赖，一个模块可以依赖多个更底层模块，但禁止出现循环依赖。

后端代码约定：

- 构造函数统一使用对象参数风格（`{ dep1, dep2 }`）。
- 新代码优先放入所属模块内部，并优先从模块根入口或模块内分层路径导入；不要继续新增全局 `handler / service / dao / event / tools / rag` 风格目录。

Agent 相关补充约定：

- 通用 Agent Runtime 内核放在 `packages/agent-runtime`，Kagami 项目语义放在 `apps/agent/src/agent`。
- `apps/agent/src/agent` 当前按 `runtime / capabilities / apps` 分层组织：
  - `runtime/`：Kagami 定制运行时，如 `RootAgentRuntime`、session（App 启动器）、NotificationCenter、事件队列、上下文渲染、App 状态持久化
  - `capabilities/`：按能力聚合的实现，当前包括 `messaging`、`context-summary`、`story`、`ithome`、`vision`、`web-search`、`browser`、`terminal`、`todo`
  - `apps/`：手机 OS 的 App（Portal 下可 enter 的地点），当前包括 `qq`、`ithome`、`hn`、`calc`、`clock`、`browser`、`terminal`、`todo`
- 新增 capability 应当符合"给 Agent 的生活添一种新的存在方式"的视角；群聊相关逻辑只属于 `messaging`，不要让它的概念扩散到 runtime 或其他 capability。
- `context-summary` 归类为 `Operation`，不是 `TaskAgent`。
- `web-search` 是标准 `TaskAgent` 能力；其对主 Agent 暴露的是 tool，私有工具跟随 task-agent 放在能力目录内。
- `Tool` 的职责是上层调用入口，不承载能力本体；业务语义应放在 capability service、task-agent 或 operation 中。
- 新实现只放在 `runtime/` 或 `capabilities/`；不要重新向 `apps/agent/src/agent/agents`、`apps/agent/src/agent/service`、`apps/agent/src/agent/dao`、`apps/agent/src/agent/tools/*` 等旧风格目录补内容。

后端当前对外接口大致分为：

- 健康检查：`/health`
- OAuth 与配额管理：`/auth/:provider/status`、`/auth/:provider/login-url`、`/auth/:provider/logout`、`/auth/:provider/refresh`、`/auth/:provider/usage-limits`、`/auth/:provider/usage-trend`
- LLM Playground：`/llm/providers`、`/llm/playground-tools`、`/llm/chat`
- Napcat 主动发送：`/napcat/group/send`、`/napcat/private/send`
- 观测与历史查询：`/app-log/query`、`/llm-chat-call/query`、`/llm-chat-call/:id`、`/napcat-event/query`、`/napcat-group-message/query`、`/story/query`
- Agent 状态与指标：`/main-agent-context/recent`、`/main-agent-context/compact`、`/metric-chart/*`、`/scheduler/*`

### 前端（`@kagami/web`）

前端是一个 React 管理台，用于观测 Agent 的"生活状态"。使用 `react-router-dom`，当前主要页面包括：

- `/main-agent-context`：主 Agent 当前上下文（默认入口）
- `/auth/:provider`：认证管理页
- `/control-panel`：控制面板（含上下文压缩等操作）
- `/scheduler-tasks`：后台任务面板
- `/llm-playground`：LLM Playground
- `/llm-history`：LLM 调用历史
- `/app-log-history`：应用日志历史
- `/napcat-event-history`：Napcat 事件历史
- `/napcat-group-message-history`：群消息历史
- `/story-history`：Story 记忆历史
- `/metric-charts`：运行时指标可视化

补充说明：

- 页面组件当前按业务域组织在 `apps/web/src/pages/*`。
- 布局组件位于 `apps/web/src/components/layout/*`。
- 需要新增或复用组件时，优先考虑使用 shadcn 现有组件，再评估是否自定义实现。
- 如果缺少所需的 shadcn 组件，可以优先通过 shadcn CLI 下载并接入。
- 当前 Vite 配置仅提供 `@ -> apps/web/src` 别名，没有内置开发代理。

### 共享包（`@kagami/shared`）

- 共享包用于承载前后端共用的 schema、DTO、工具函数。
- 后端接口 schema 与前端消费模型尽量优先收敛到该包，避免重复定义。

## 部署说明

### 前端代理与静态托管

- 生产环境中，PM2 托管的网关进程 `kagami-gateway`（`apps/gateway`）会提供 `apps/web/dist`，并按路径前缀分流 `/api/*`：`/app-log`、`/llm-chat-call`、`/napcat-event`、`/napcat-group-message`、`/metric-chart` 这几类纯查询代理到管理台后端进程 `kagami-console`（默认 `20006`），其余仍代理到 `kagami-agent`（默认 `20003`）。上游地址不再走 env，由网关自读 `config.yaml` 顶层 `services` 块寻址（见 issue #162）。
- 该静态服务还暴露 `/health`。
- 当前仓库中的 Vite 配置未内置开发代理；如需本地前后端分离调试，需要自行在 `apps/web/vite.config.ts` 中补充 `server.proxy`。

### PM2

- PM2 配置文件位于仓库根目录 `ecosystem.config.cjs`。
- 后端（`kagami-agent`）：单进程 `fork` 模式运行 `apps/agent/dist/index.js`，默认监听 `20003`。承载 Agent 生活运行时与依赖其活内存的接口（实时上下文、story、auth、scheduler、LLM playground、QQ 主动发送）。
- 管理台后端（`kagami-console`）：单进程运行 `apps/console/dist/index.js`，默认监听 `20006`（端口取 `config.yaml` 的 `services.console.port`）。服务前端的纯 DB 查询（app-log / llm-chat-call / napcat-event / napcat-group-message / metric-chart），经 `@kagami/persistence` 的共享 DAO 直读同一个 SQLite 库；与 `kagami-agent` 并发读写靠库文件级 WAL（两进程启动均 `configureSqlite`）。
- 网关（`kagami-gateway`）：单进程运行 `apps/gateway/dist/index.js`（TS，零 `@kagami/*` 依赖），默认监听 `20004`，托管 `apps/web/dist` 静态资源并按前缀把 `/api/*` 分流到 `kagami-console` 或 `kagami-agent`。监听端口与上游地址全部自读 `config.yaml` 的 `services` 块。
- 对象存储（`kagami-oss`）：单进程运行 `apps/oss`，默认监听 `20005`（仅 localhost），端口取 `config.yaml` 的 `services.oss.port`。
- 浏览器（`kagami-browser`）：单进程运行 `apps/browser/dist/index.js`，默认监听 `20007`（仅 localhost，端口取 `config.yaml` 的 `services.browser.port`）。持有 CloakBrowser 与凭据注入；PM2 `cwd` 固定仓库根，让 `userDataDir`（`data/browser/default`）落在仓库根 `data/` 下，登录态跨 agent 重启留存。独立生命周期是「agent 重启不杀浏览器」的根——`app:deploy agent` 不触及它（见 issue #173）。
- `pnpm app:deploy` 会执行构建、Prisma 迁移、PM2 reload/startOrReload，以及 `pm2 save`。
- `pnpm app:deploy <agent|console|gateway|oss|browser>`（带服务名）只重建并重载该服务（含其依赖包），不跑迁移、不动其它进程。改了某个服务时用它即可——尤其重载 `console` / `gateway` / `browser` 不会打断 `kagami-agent` 的热状态（KV 缓存前缀、HNSW 索引、活内存上下文），符合 KV 缓存优先原则。涉及 DB schema 变更仍走无参 `pnpm app:deploy`。（`web` 作为 `gateway` 的已弃用别名仍可用。）
- 数据库为进程内 SQLite 文件（`data/sqlite/kagami.db`），宿主机不再需要运行 PostgreSQL；Napcat 仍作为外部依赖运行，`config.yaml` 中通常使用 `localhost` 地址访问。
- 部署机需要能编译/安装原生模块（`better-sqlite3`、`hnswlib-node`）；这些依赖的构建脚本已在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 中放行。

# gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools directly.

Available skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:

- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## Deploy Configuration (configured by /setup-deploy)

- Platform: 本地宿主机（PM2 fork 模式，无任何云平台 / PaaS）
- Production URL: http://localhost:20003（agent）、http://localhost:20004（kagami-gateway：静态托管 + 代理 /api/\*）
- Deploy workflow: 手动触发，无自动 push 部署
- Deploy status command: pm2 status / pm2 list
- Merge method: PR merge（主分支 master）
- Project type: 后端 Agent 服务 + React 管理台（monorepo）
- Post-deploy health check: curl http://localhost:20003/health（web: http://localhost:20004/health）

### Custom deploy hooks

- Pre-merge: pnpm build && pnpm typecheck && pnpm lint && pnpm format
- Deploy trigger: pnpm app:deploy（= bash ./scripts/deploy.sh：build → prisma migrate deploy → PM2 reload/startOrReload → pm2 save）
- Deploy status: pm2 status
- Health check: curl -sf http://localhost:20003/health

### ⚠️ 部署红线（用户硬约束）

- **未经用户明确要求，绝不自行执行 `pnpm app:deploy` 或任何部署动作。**
- gstack 的 `/land-and-deploy` **仅用于合并 PR**：跑到合并 PR（Step 4）即停，绝不进入它后续的自动部署（Step 5/6）与 canary 验证（Step 7）。它默认的「merge→自动 deploy」尾巴与 Kagami 的本地 PM2 模型不匹配，必须砍掉。
- 部署一律单独走 `pnpm app:deploy`，且只在用户当轮明确要求时执行。
