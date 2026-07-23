# 指示

你的一切交流和汇报，使用简体中文。

这份文件是**给 AI 协作者的操作手册**：最高优先级规则 + 常用入口。详情分散在同级文档：

- **架构 / 包拓扑 / 模块 DAG / 数据流** → [ARCHITECTURE.md](./ARCHITECTURE.md)
- **配置分区 / SQLite 布局 / Prisma 迁移** → [docs/configuration.md](./docs/configuration.md)
- **视觉 / UI 设计系统** → [DESIGN.md](./DESIGN.md)
- **项目理念与使用入口** → [README.md](./README.md)
- **待办** → [TODOS.md](./TODOS.md)

## 阅读路径（按任务选）

- 第一次上手，想理解 Kagami 是什么 → 本文「项目理念」+ README.md
- **动手写任何新 capability / tool / task agent 之前** → 本文「开发原则：KV 缓存命中率优先」（必读，含三个参考实现）
- 找代码放哪、模块怎么依赖 → ARCHITECTURE.md
- 改配置或 DB schema、跑迁移 → 本文「硬约束」+ docs/configuration.md
- 改前端视觉 → DESIGN.md
- 提交前检查、部署 → 本文「硬约束」+「部署红线」

## 项目理念（必读）

Kagami **不是一个 QQ 群聊机器人**，而是一个**拥有自己生活的 Agent**。

群聊只是她生活的一部分，就像一个人不会把自己定义为"聊天的人"。只要给她足够多的能力（capability），她就可以像一个真正的人那样，去读新闻、去记住发生过的事、去主动做自己感兴趣的事。项目的核心概念是 **Agent as a life**：

- QQ 群消息只是她接收到的一种事件，与 RSS 轮询、定时任务、系统通知在架构上是平级的"生活输入"。
- 她有自己的兴趣（IThome 轮询、主动发言）、自己的节奏（事件队列、空闲时刻的后台动作）；长期记忆系统正在重新设计（原 Story 记忆已拆除，仅保留 `ledger` 消息账本作原始素材）。
- 新增 capability 时，应该问自己："这是在给 Agent 的生活加一种新的存在方式吗？"，而不是"这是在给聊天机器人加一个功能吗？"。
- 不要把 NapCat、群聊相关的概念泄漏到 `agent/runtime` 的核心抽象里。它只是众多外部事件源之一。

任何架构决策、模块划分、命名，如果与这个定位冲突，定位优先。

## 开发原则：KV 缓存命中率优先

开发 Agent 的新功能时，**必须非常非常重视 KV 缓存能否命中**。provider 侧 KV cache 的命中与否直接决定每轮推理的延迟和成本，一次前缀漂移会让整段历史从零换入。这条原则的优先级等同于项目理念，任何新 capability / task agent / tool 在设计阶段就要想清楚"它会不会让已有会话的前缀失效"。

### 核心模型：稳定前缀 + 易变尾部 + 计划性重建

把 Agent 的 message 列表想象成三段：

1. **稳定前缀**：system prompt、工具定义、历史对话。只追加、不修改。
2. **易变尾部**：当轮新事件、通知注入、工具调用结果。可以变，但只影响最后一段。
3. **计划性重建**：只有上下文压缩这类明确的、罕见的动作才允许整体 `replaceMessages`，一次性把旧前缀换成更短的新前缀，从此作为新的稳定前缀继续生长。

对应到运行时，`AgentContext` 只暴露两个会改动 message 列表的操作：`appendMessages`（保留前缀）与 `replaceMessages`（明确破坏并重建前缀）。新功能如果既不是追加也不是压缩，就要警惕。

另外两条与 ReAct 循环相关的既定语义（#268）：主 Agent 每轮 `toolChoice: auto`，assistant 的纯文本输出是**用完即弃的草稿**——持久化边界剥掉 content、只留 tool_use / tool_result 进上下文（完整原文在 `llm_chat_call` 可查）；模型某轮零工具调用时主循环**挂起等下一个事件**，不会立即再起一轮。thinking 目前显式关死（`disabled`），开启 adaptive thinking 需要 thinking 块全链路支持，见 issue #269。

### 工具组织：InvokeTool 是顶层工具集的稳定壳

`InvokeTool` 是 Kagami 工具系统不可动摇的结构性支柱。它本身是一个 meta-tool，只接 `name` 和 `args` 两个参数，但内部承载所有 capability / App 的具体工具。这样设计的关键收益是：**LLM API 的 tools 列表始终只有少数几个顶层工具**（`switch` / `wait` / `invoke` / `help` 这一类结构 / 能力级元工具），从启动到关停不变，不论项目里有多少 capability、多少 App 都不影响。（App 名单本身每轮由主循环渲染进 system prompt，让 Agent 天然知道有哪些 App 可切；靠「App 集合进程内不可变」这条不变量保证每轮字节恒定、前缀不漂移，名单只在增删 App 时变、必然伴随重启。）

如果不通过 InvokeTool，每加一个工具都要在 LLM 的 tools 参数里多一个 entry，这是稳定前缀的一部分，意味着每加一个新工具都会让所有进行中的会话从零换入。InvokeTool 把"加新东西就触发一次前缀失效"的代价从"每加一个工具一次"压缩到"几乎不会发生"。

具体工具的能力 / 参数 / 用法有两种披露方式：

- **早期方案**：把全部子工具的文档塞进 InvokeTool 自己的 description 里。前缀里有完整子工具索引，但加新子工具会改 InvokeTool description 一次（仍然比加顶层工具便宜）。
- **渐进式披露**（App 框架的目标）：前缀里几乎不写子工具信息，Kagami 通过 `enter(<appId>)` + `help` 两个动作在运行时按需探索能做什么。每个 App 的工具只在 Kagami 真正"进入"该 App 时通过 help 询问才会被披露。前缀对 App 数量完全不敏感。

写新 capability 或 App 时记住：**任何想暴露给 Agent 的能力，第一反应都应该是"做成 InvokeTool 的子工具"，而不是"加一个顶层工具"**。新增顶层工具需要明确的设计理由：它必须是结构性的元能力（像 switch / help 这种调度 / 导航工具），而不是某个具体业务能力。

### 现有实现里的三个范例

写新 capability 前，先读这三处代码，它们是 KV 缓存友好的参考实现。（另一条通则：任何会产生大量中间 token 的能力——搜索、抓网页、读长文件、跑代码——都应封装成 TaskAgent，通过终止工具只向主 Agent 回传摘要，原始素材留在子 Agent 上下文里用完即弃，别让它进主 Agent 的消息列表。`context-summary` / `todo` 两个 fork 型 task agent 是现存实例。）

**1. NotificationCenter —— 追加到尾部，而非插入前缀**

各生活输入（IThome 新文、QQ 未读、todo 提醒）经 `NotificationCenter` 窗口聚合后，作为一条 `notification` 事件进共享事件队列；`RootAgentSession` 在路由时通过 `createNotificationMessage` 装配成一条 `<notification>` user message，**追加到消息尾部**并触发一轮 round。它绝不把通知内容塞到 system prompt 或历史中段。异步工具结果（`<async_tool_result>`）走的是同一条尾部追加路径。

**教训**：想给 Agent "喂"外部信息（新闻、提醒、周期状态、异步结果、以及将来的记忆召回），一律**往尾部 append**。永远不要为了"让它更显眼"而把动态内容插到 system prompt 或前缀里——那会让整个会话每轮都从零换入。

**2. Context Summarizer —— 唯一允许破坏前缀的地方**

`RootAgentRuntime.compactContextIfNeeded` 在 token 超阈值时触发压缩：计算保留边界（最近 10% 消息，扩展到 tool-call 边界），对前半部分生成摘要，然后用 `replaceMessages([summaryMessage, ...messagesToKeep])` **一次性**重建整条消息列表。这一次重建会彻底失效旧的 KV cache，但换来的是一个更短、更稳定的新前缀，后续多轮共享。压缩后通过 `notifyContextCompacted()` 通知所有扩展重置自身临时状态，让它们配合新前缀继续工作。

**教训**：`replaceMessages` 是一次"受控的昂贵操作"。除了上下文压缩这种明确场景，不要再引入第二种会调用它的路径。任何新功能想"改写一下历史"，都应该先问：能不能改成 append？

**3. Foreground Input —— 不带内容的敲门，drain 时现拉，仍走尾部追加**

QQ 前台当前会话的新消息不经 NotificationCenter，走 `runtime/root-agent/foreground-input.ts` 的敲门路径：App 把消息缓冲在自己内存里，只 enqueue 一个**不带内容**的 `foreground_input` 事件；session drain 时向当前前台 App（实现 `ForegroundInputSource` 的）现拉渲染好的文本，作为一条 user message **追加到尾部**。内容 drain 时才现取所以永不 stale；焦点已切走时拉空 no-op，未投递的未读退化回通知路径，绝不静默丢。

**教训**：实时性再高的输入也不需要绕过尾部追加。把「唤醒」和「内容」拆开——事件只当敲门铃，内容在注入时刻向源现拉——既保住稳定前缀，又避免把会过期的数据写死进事件队列。

### 具体红线

- **不要**在 system prompt 或稳定前缀里写入时间戳、随机 ID、轮次计数、当前时间、会变的运行时状态。这些属于尾部或工具结果。
- **不要**在一轮内反复改写 system prompt 或工具描述来"传递状态"。状态走消息尾部或工具参数。
- **不要**为了排版/美观调整历史消息的序列化格式、字段顺序、JSON 键顺序——同一会话内这类改动会让已命中的前缀全部报废。
- **不要**给主 Agent 添加会返回大块原始数据的工具。大数据先进子 Agent（TaskAgent），再以摘要回传。
- **不要**在压缩之外的地方调用 `replaceMessages`。
- **fork 型 task agent 一律用 `usage: "agent"`，绝不为它单开一个 usage**：`usage` 是「KV 缓存身份」（决定 provider/model），只有 `agent` / `vision` 两个值。凡是复用主 Agent 前缀（system + tools + 消息历史）的子任务（`contextSummarizer` / `todoSuggestionAgent` / `innerVoice` 等），模型必须与主 Agent 逐字节一致才可能命中 prompt cache——给它单配一个 usage 就是只能配错的脚枪。「哪个业务场景发起的」这类归因走 `LlmClient.chat` 的 `scene` 自由字段（进 metric 标签 + `llm_chat_call.scene` 落库），与选模型解耦。见 issue #555。
- **system prompt 和工具集的改动要集中提交**：每次改动都会让所有在飞会话的前缀失效一次，小步高频修改是最糟糕的模式。
- **进上下文的散文一律走模板，禁止在 TS 里内联字面量**：任何最终会进 LLM 上下文的成句文案（system prompt、各类 reminder、`<notification>` / `<async_tool_result>` 等伪标签内容、通知 draft 的渲染文本）都必须落在 `apps/agent/static/` 下的 `.hbs` 模板，经 `renderServerStaticTemplate(import.meta.url, ...)` 渲染。TS 侧只负责算 view-model（计数、数组、布尔 flag、预格式化好的日期/截断文本），不写成句文案。这样调小镜的语气只改 `static/` 一棵树、不碰代码，也让"所有会进上下文的文本"始终收在同一处可审。**例外（留 TS 常量）**：分组 key / 结构标识（如 `"QQ"`、`"IT之家"`、`"待办"`）这类不是语气的标识符；以及工具 description 与工具 result 的 error/status note（前者绑 param schema 属渐进式披露垂直切片，后者进易变尾部且与控制流交织，见 `TODOS.md`）。
- Review 新 capability / task agent / tool 时，把"会不会破坏 KV 缓存命中"以及"进上下文的散文是否走了模板"作为显式检查项写进自检清单。

## 硬约束

- 除非任务明确要求，否则一切交流与汇报统一使用简体中文。
- 除非任务明确要求，否则默认在仓库根目录执行命令。
- 数据库按服务独立（epic #539）：主库（agent 独占）读 `config.yaml` 的 `server.databaseUrl`；napcat / llm / scheduler 各自读 `services.<svc>.databaseUrl`。查哪张表先确认归属库（布局见 docs/configuration.md）。
- **改配置 schema 必须同步三处**：`packages/kernel/src/config/config.loader.ts`、`config.yaml`（非隐私，纳入版本控制）、`config.secret.yaml.example`（隐私模板，新增隐私字段在这里补占位）。
- **提交前至少执行**以下五项，且全部成功：

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm format
pnpm knip
```

## 代码放哪（边界铁律）

完整的包拓扑与模块 DAG 见 [ARCHITECTURE.md](./ARCHITECTURE.md)。写代码时守住这几条边界：

- 后端 `apps/agent` 用「扁平模块 + 模块内分层」（`domain / application / infra / http`）。新代码放进所属模块，从模块根入口或分层路径导入；**不要**新增全局 `handler / service / dao / event / tools / rag` 风格目录。
- 通用 Agent Runtime 内核放 `packages/agent-runtime`（`TaskAgent` / `Tool` / `App` 框架；原 `Operation` 概念已退役，一次性子任务一律做成 TaskAgent + 终止工具）；**不要**把 NapCat 事件模型、Kagami system prompt、`RootAgentRuntime`、具体 capability 塞进去。Kagami 项目语义放 `apps/agent/src/agent`。
- `apps/agent/src/agent` 按 `runtime / capabilities / apps` 分层；新实现只进 `runtime/` 或 `capabilities/`，不要回填旧风格的 `agents / service / dao / tools/*` 目录。
- `Tool` 只是上层调用入口，不承载能力本体；业务语义放 capability service / task-agent。
- 群聊相关逻辑只属于 `messaging` capability，不要扩散到 runtime 或其他 capability。

## 常用命令

```bash
pnpm build        # 按 workspace 依赖拓扑构建所有包
pnpm typecheck    # 全部包类型检查
pnpm test         # 根级 vitest projects 单进程跑全部包的测试（新包只需自带 vitest.config.ts 即被纳入）
pnpm lint         # ESLint 检查（lint:fix 自动修复）
pnpm format       # Prettier 检查（format:write 自动格式化）
pnpm knip         # 死代码/僵尸依赖审计。CI 门禁分级：孤儿文件/未用依赖/未声明依赖为 error（卡 CI），
                  # 未用 export / type 仅 warn（进报告不卡 CI，配置见 knip.json）。需先 pnpm build（解析跨包 dist）

pnpm --filter @kagami/agent <script>   # 单包命令，如 test / test:watch / db:*

pnpm app:deploy                        # 全量部署：build → prisma migrate deploy → PM2 reload(全部) → pm2 save
pnpm app:deploy <agent|console|gateway|oss|browser|llm|metric|spire|pixel|gba|napcat|scheduler>  # 单服务：只重建重载该服务，不跑迁移、不动其它进程

pnpm app:stop                          # 停掉 ecosystem 里全部进程
pnpm app:stop <agent|console|gateway|oss|browser|llm|metric|spire|pixel|gba|napcat|scheduler>    # 只停该服务（与 app:deploy 共用同一套短名别名）
```

- 仓库当前**没有**统一的根 `pnpm dev`。前后端联调需按实际分别启动，不要假设有一键 dev。
- DB 迁移命令与流程见 [docs/configuration.md](./docs/configuration.md)。

## 代码规范

**Prettier**：双引号、分号、2 空格缩进、行宽 100、尾逗号 `all`。

**TypeScript**：所有包继承 `tsconfig.base.json`（`strict: true`）。后端与 shared 用 `module/moduleResolution: NodeNext`，前端用 `Bundler` 并额外开 `noUnusedLocals` / `noUnusedParameters`。路径别名以各包 `tsconfig.json` 实际配置为准，不要臆测。

**ESLint**：忽略 `dist/` / `build/` / `node_modules/` / `prisma/generated/`；前端启用 `react-hooks` / `react-refresh`。

**导入约定**：

- 各 `*-api` 契约包与 `@kagami/http` **不提供根 barrel**，用显式子路径导入（`@kagami/http/wire`、`@kagami/console-api/app-log`）；需要 Zod 从 `zod` 导入。原 `@kagami/shared` 已退役（#279）：wire 基元在 `@kagami/http/wire`，各服务 wire schema 在其 `*-api` 包，通用文本工具在 `@kagami/kernel/utils/*`。
- 新代码不要新增 re-export / barrel 文件，优先直接导入真实实现路径或包的显式子路径。
- 后端构造函数统一用对象参数风格（`{ dep1, dep2 }`）。

## 设计系统

任何视觉 / UI 改动前，**先读 [DESIGN.md](./DESIGN.md)**。字体、颜色、间距、布局、美术方向都在那里，未经用户明确批准不要偏离。要点：

- 方向代号：**晒褪了色的蒙德里安 / The Painted Ledger**（蒙德里安骨架 + 文艺复兴 / 印象派颜料色）。
- 前端不再用 shadcn 的有样式组件与默认 slate 主题；保留 Radix 无样式行为基元，其余外观自定义。
- 配色铁律：颜色是配给不是涂抹，90% 中性 + 暖近黑，饱和色只落在「活着 / 有语义」的数据上（红 = 错/主动发言、蓝 = LLM/context、黄 = scheduler/等待、绿 = 记忆/持久数据、茜 = 高成本）。
- QA / Review 时，发现不符合 DESIGN.md 的代码要标出来。

## 部署速查

进程拓扑与端口见 [ARCHITECTURE.md](./ARCHITECTURE.md)「部署」。操作层面：

- `pnpm app:deploy`（无参）= 全量：build → Prisma 迁移 → PM2 reload/startOrReload → `pm2 save`。**涉及 DB schema 变更必须走这个**（会跑 `prisma migrate deploy`）。
- `pnpm app:deploy <服务名>` = 单服务：只重建重载该服务。改单个服务时优先用它——重载 `console` / `gateway` / `browser` / `llm` / `metric` / `spire` / `pixel` / `gba` / `napcat` / `scheduler` 不会打断 `kagami-agent` 的热状态（KV 缓存前缀、HNSW 索引、活内存），符合 KV 缓存优先。（`web` 是 `gateway` 的已弃用别名。）
- `kagami-browser` / `kagami-llm` / `kagami-metric` 是独立进程，`app:deploy agent` 不触及它们，让「agent 重启不杀浏览器 / 不打断 LLM 服务与登录态 / 不丢 metric 通道」。metric 摄取是 fire-and-forget，服务挂掉只丢点、不影响 agent。

## 部署红线（用户硬约束）

- **未经用户明确要求，绝不自行执行 `pnpm app:deploy` 或任何部署动作。**
- gstack 的 `/land-and-deploy` **仅用于合并 PR**：跑到合并 PR（Step 4）即停，绝不进入后续的自动部署（Step 5/6）与 canary（Step 7）。它默认的「merge → 自动 deploy」尾巴与 Kagami 的本地 PM2 模型不匹配，必须砍掉。
- 部署一律单独走 `pnpm app:deploy`，且只在用户当轮明确要求时执行。

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

- Pre-merge: pnpm build && pnpm typecheck && pnpm lint && pnpm format && pnpm knip
- Deploy trigger: pnpm app:deploy（= bash ./scripts/deploy.sh：build → prisma migrate deploy → PM2 reload/startOrReload → pm2 save）
- Deploy status: pm2 status
- Health check: curl -sf http://localhost:20003/health
