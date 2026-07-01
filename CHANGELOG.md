# Changelog

本项目所有重要变更记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
本仓库启用 4 位版本号 `MAJOR.MINOR.PATCH.MICRO`，事实来源为仓库根目录 `VERSION` 文件，`package.json` 的 `version` 字段与之保持同步。Kagami 自部署、不对外分发，版本号仅用于标记部署节点与变更归档，不承载语义化版本对外兼容承诺。新条目按提交时间倒序追加在 `## [Unreleased]` 下，发布时归档到对应版本分节（`## [x.y.z.w] - YYYY-MM-DD`）。每个 PR 必须 bump `VERSION`（CI 强制校验 PR 版本号高于 master）。

## [Unreleased]

## [0.3.5.3] - 2026-07-01

### Changed

- messaging/qq: QQ 通知从「摘要 + 正文」精简为**纯信号**，去掉最新消息正文预览，让通知重新变回"诱饵"而非"信息流"。此前通知行把最新一条消息的发送者与正文（40 字）直接摊进主上下文，小镜不进群（`open_conversation`）也能被动跟上群里在说什么——而读通知不清未读、不算参与，于是它理性地选择不进群：该知道的通知里都说了，进去成本更高。改后通知只保留"有事发生、值得进去"的信号，想看具体内容必须 `open_conversation`。
  - `ChatNotificationDraft.render()` 只出两类标签：未读计数 `[N 条消息]`（>1 时，超 99 显 `99+`，逻辑不变）与 `[有人 @ 你]`；两者都没有（只 1 条且没 @）时兜底显示 `有新消息`。不再渲染消息正文。
  - 构造函数去掉 `latestText` 参数，`QqApp.ingestMessage` 不再计算/传入消息预览（删除只服务于此的 `renderMessagePreview`）。未读计数、@ 判定等内部状态与清零逻辑均未改动，只是不再泄漏进通知行。

## [0.3.5.2] - 2026-07-01

### Fixed

- napcat/messaging: 修复**按 UTF-16 长度截断劈开 emoji 代理对**导致主 Agent 整条会话被打挂的事故。QQ 引用回复预览（`group-message-processor` 的 `messagePreview`）等处用 `str.slice(0, N)` 截断，若第 N 个码元正好落在一个 emoji 的代理对中间，就会留下半个高代理项（lone surrogate）。这条脏字符进入主 Agent 的持久上下文后，**每一轮 root-agent LLM 请求体都是非法 JSON**，Anthropic 上游以 `400 invalid_request_error: no low surrogate in string` 拒绝，root agent 陷入无限重试、彻底不能思考（进程存活但功能性死亡）。
  - 新增码点安全工具 `@kagami/shared/utils` 的 `stripLoneSurrogates`（剥除落单代理项）与 `truncateWithEllipsis`（按 Unicode **码点**而非 UTF-16 码元截断，`Array.from` 拆分，绝不切开代理对，且先剥除已有落单代理项）。
  - 全部 4 处按长度截断改用 `truncateWithEllipsis`：QQ 引用预览（确诊元凶）、合并转发单节点、聊天通知 draft、图片描述——它们的产物都会进主上下文，任一处劈开代理对都足以打挂会话。
  - 事故现场处置（不在本 PR）：从 `root_agent_runtime_snapshot` 剥除那一个落单 `U+D83C` 并重启，保住全部历史。

### Changed

- config: 把 committed `config.yaml` 从「示例默认值」更新为**部署机的真实非隐私配置**（story 关闭、真实模型路由如 claude-opus-4-6/haiku、真实超时与通知窗口、真实 provider models 等），使受控 `config.yaml` 与实际部署零漂移——此前 committed 版本是从 example 派生的模板，与线上实际值差异很大。
- config: `server.napcat.wsUrl` 加入 `CONFIG_SECRET_WHITELIST`。napcat WS 地址内嵌 `access_token` 属凭据，而本仓库公开，故整条 `wsUrl` 移入 gitignored 的 `config.secret.yaml`（committed `config.yaml` 不再含 `napcat.wsUrl`，由 secret 深合并提供）；`config.secret.yaml.example` 补上占位条目。
- config: 移除死配置 `server.llm.providers.mimo`——`mimo` 不是 `LLM_PROVIDER_IDS` 的合法 provider（会被 schema 静默丢弃）、也无 usage 引用，是遗留的无用块（且带着一个真实 key）。

### Added

- todo: 每日两次的 digest 通知在「未完成汇总 + 通用 nudge」之外新增**第三段「建议待办」**（见 [#183](https://github.com/KisinTheFlame/kagami/issues/183)）。每次回顾时从主 Agent 上下文 fork 一份、跑**一次性单次 LLM 发现**（`TodoSuggestionService.propose`，仿 context-summary，无工具循环），据当前未完成清单去重后直接给出**最多 5 条具体、可执行的候选待办**；小镜读了自行决定是否 enter todo App 用 add-todo 添加（纯文本，不落库、无新状态机）。
  - **KV 缓存前缀零影响**：`TodoSuggestionService` 不持有 `AgentContext` 句柄、只收克隆的 `messages`，类型上就无法改主上下文；建议只经 `<notification>` 追加到上下文尾部，不触 system prompt / 历史 / 顶层工具集。fork 子调用用独立 `propose_todos` 工具，属隔离 throwaway。
  - **快照读串行化**：`RootLoopAgent` 新增 `getContextSnapshot()`，经 `mutationExecutor` 串行化取快照，避免与主轮次 `persistRoundState` 中途「assistant tool_call 无 tool_result」的不平衡视图竞态。
  - **三重降级**：fork 任何失败（无 provider / 超时 / 无 toolCall / 解析失败 / 空）一律返回 `[]`，digest 照发只含原两段，绝不抛错、不丢 digest。
  - **配置**：新增独立必填 usage `todoSuggestionAgent`（`config.yaml` 已含，模型可独立选）。

## [0.3.4.0] - 2026-07-01

### Added

- config: 新增领域无关的叶子包 `@kagami/config`（deps 仅 `yaml`，零 `@kagami/*` / 零 zod），把「怎么定位并读一个配置文件」这层通用机制收敛成单一事实来源（见 [#180](https://github.com/KisinTheFlame/kagami/issues/180)）。此前 repo-root / git-worktree 锚点逻辑在 kernel loader、gateway、oss、`scripts/read-config.mjs` **四处各自重复**；现在四个 reader 全部复用 `@kagami/config` 的 `resolveConfigPath`。包内含：`resolveConfigPath`（depth-agnostic 向上定位 + worktree 回退）、`deepMerge`、`assertSecretWhitelist`（按路径前缀的隐私白名单）、`loadMergedRawConfig`、自有 `ConfigError`（与 `BizError` 同形但不反向依赖 kernel）。领域 schema（`ConfigSchema` / `Config` / `loadStaticConfig`）与「哪些路径算隐私」的白名单内容仍留在 kernel，作为参数下传——config 包不认识任何领域字段。`loadStaticConfig` 签名与返回类型逐字不变，agent/console/browser 消费方零改动。

### Changed

- config: 把 `config.yaml` 按「隐私 vs 非隐私」拆成两份（见 [#180](https://github.com/KisinTheFlame/kagami/issues/180)）。非隐私配置（服务拓扑 / 阈值 / baseUrl / models 等）留在 `config.yaml` 并**纳入版本控制**（不再 gitignore、不再提供 `config.yaml.example`）；隐私配置（各 `apiKey` / `bot.qq` / `bot.creator` / `napcat.listenGroupIds` / 浏览器 `proxy`·`licenseKey`）落到 gitignored 的 `config.secret.yaml`，改提供 `config.secret.yaml.example` 模板。启动时 `@kagami/config` 定位并**深合并**两文件（冲突 secret 优先、数组整体替换），再交 `ConfigSchema` 校验，**零 schema 字段改动**。
  - **Secret 白名单**：`config.secret.yaml` 只允许出现 `CONFIG_SECRET_WHITELIST`（`packages/kernel/src/config/config.loader.ts`）内的隐私路径前缀；出现白名单外的键（尤其 `services.*` / `server.databaseUrl`）启动即抛 `CONFIG_SECRET_FORBIDDEN_KEY`——这保证 secret 永不能改动 gateway/oss/read-config 也在读的非隐私拓扑，各进程共享字段永远一致。
  - **缺文件响亮失败**：缺 `config.secret.yaml` 时抛 `CONFIG_SECRET_NOT_FOUND` 并在报错里给出 `cp config.secret.yaml.example …` 提示。
  - **原型污染防护**：`deepMerge` 丢弃 `__proto__` / `constructor` / `prototype` 键并用 `hasOwnProperty` 判定；`assertSecretWhitelist` 按点分段拒绝这些段（防「`<白名单前缀>.__proto__.x` 借前缀匹配穿透」），双层兜底。
  - **对 KV 缓存前缀零影响**：不触 system prompt / 工具集 / 工具描述 / 消息序列化，纯配置装载层。
  - **部署前置（部署机一次性，无 DB 变更）**：部署机现有 gitignored `config.yaml` 转为受版本控制后，`git pull` 会因「未跟踪文件将被覆盖」拒绝——需先备份现有 `config.yaml`、抽出隐私叶子写入新建 `config.secret.yaml`、再让位受控版本，然后 `pnpm app:deploy`。

## [0.3.3.0] - 2026-07-01

### Changed

- web: 前端配色方向从「晒褪 / 配给」转为 **「鲜艳大胆 + 二维大色块」**（仍是蒙德里安骨架：2px 黑硬线 / 0 圆角 / 衬线标题 / 等宽数据）。用户反馈旧版太灰、色彩做没了，遂把语义色换成蒙德里安**饱和原色**（红 `#D62818` / 蓝 `#143CB0` / 黄 `#F7C400` / 绿 `#2F8F4E` / 玫红 `#B61E3C`，浅深两套），颜色从「配给」改为「结构」——以填实色块 / 状态格 / 大数字上墙。
  - `Badge` 新增 `signal/llm/scheduler/story/cost` 填实语义变体（2px 黑描边、不渐变、不 hover 淡化）；侧栏选中改正黄色块、字标用新增的 `--sidebar-brand` token。
  - 主 Agent 上下文页：feed 事件=红 / 消息=蓝填实标签、轮询状态=黄；AuthPage 登录状态 / 警告 / 额度改填实，**额度卡做成填实大色块**（按用量绿→黄→玫红，大号 mono 数字 + 白/黑字，去掉冗余进度条与 tone pill）。
  - `DESIGN.md` 美术方向 / 色彩 / 布局 / 决策日志同步改向（饱和原色 + 填实大色块 + **二维横竖构图**，不再是从上往下的等宽卡片流）。
  - 经三档 HTML 样例对比后用户选「档 3」；纯前端表现层，不涉及后端 / API / 数据流，对 KV 缓存前缀无影响。landing 的统计大色块簇需后端补聚合数据（已记 TODOS），本轮只在数据已就绪处上色块。
- web(design-review): 经 `/design-review`（Codex + opus 子 Agent 双路）走查并修复鲜艳版 4 类问题：①填实色块文字达 WCAG AA（浅色把红/绿晒深至白字 4.5:1，暗色改「亮原色 + 黑字」）；②补回填实徽章丢失的 2px 黑描边（`border-foreground` 漏了 `border` 宽度类）；③Auth 趋势 / Metric 系列图表色换饱和原色；④把填实语义 `Badge` 变体铺到 app-log 级别 / scheduler 状态 / llm-history / Story / Playground（此前只在 main-agent-context 落地）。

## [0.3.2.4] - 2026-07-01

### Changed

- refactor(oss): 把自建对象存储 `@kagami/oss` 摆正为「typed content-addressed object store」，并把图片 mime 收敛到单一事实来源（见 [#176](https://github.com/KisinTheFlame/kagami/issues/176)）。动机：OSS 当初想做成「纯字节、格式无关」却带了 `mime` 列，定位与实现打架——但带 content-type 的对象存储正是 S3/MinIO 的标准模型，做错的只是「只认字节」的自我叙述。落地：①`object-store` / `oss-client` 文档诚实化，去掉「只认字节」自相矛盾表述，明确 content-type 是对象一等元数据、内容寻址去重是内部实现细节；②新增 agent 侧 byte-sniff 探测器 `apps/agent/src/oss/detect-mime.ts`（magic bytes 识别 PNG/JPEG/GIF/WebP/BMP/AVIF/HEIC，认不出回落 `image/*` header 否则 `application/octet-stream`；泛 HEIF brand `mif1`/`msf1` 刻意不归一以免误标）；③QQ 入站图改为「先读字节再 `detectMime`」，退役 URL 扩展名猜测分支。**不触碰 system prompt / 工具集 / 工具描述 / resid 格式，对 KV 缓存前缀零影响。**

### Fixed

- fix(napcat): 修复 QQ 入站图片在 `content-type` header 缺失/错误且 URL 无扩展名时、即便字节是合法图片也被静默丢弃的 bug（旧逻辑在读 body 前靠 header/URL 扩展名推断 mime，推不出即 `return null`）。现按真实字节 magic 探测，严格减少误丢；同时给图片下载加 32 MiB size cap（content-length 早拒 + 实际字节兜底），防坏 URL / 过期 CDN / 大 HTML 响应打满带宽或 OOM。

### Removed

- chore(persistence): 删除只写不读的死列 `image_asset.mime`（`findByFileId` 从不 select 它、`ImageAssetRecord` 也无此字段），mime 的权威来源统一为 OSS 对象的 content-type。附带迁移 `20260701040000_drop_image_asset_mime`（SQLite RedefineTables 重建表 + 保留唯一索引，已在有数据的库副本验证行幸存）。该迁移同时修正了 master 既有的 schema↔迁移 drift（schema 已无 mime 但 `add_image_asset` 迁移仍 CREATE 了该列、缺一条 drop）。

## [0.3.2.3] - 2026-07-01

### Changed

- refactor: 把后端共享包 `@kagami/server-core` 按「是否绑原生模块 / 是否绑 fastify」两条接缝拆分为三个职责单一的小包（见 [#174](https://github.com/KisinTheFlame/kagami/issues/174)）：`@kagami/kernel`（纯净基础设施——config / logger / common 契约与错误 / `isRecord` 等纯工具，**无 fastify / 无 Prisma / 无 better-sqlite3**）、`@kagami/http`（仅 `route.helper`，依赖 fastify + zod，**零 `@kagami/*` 依赖**的叶子包）、`@kagami/persistence`（Prisma client + generated client + 所有业务 DAO + Prisma JSON helper，依赖 `@kagami/kernel`）。动机：项目即将出现**不碰 DB / 不提供 HTTP 接口**的轻量服务，单包结构会强迫它们拖入整条 Prisma + `better-sqlite3` 原生模块或 fastify；拆分后这类服务可在零原生模块 / 零 fastify 的依赖闭包下复用 kernel。落地细节：`prisma-json` 中与 Prisma 无关的纯 `isRecord` 抽到 `@kagami/kernel/json/is-record`，Prisma 专用 JSON helper 留在 persistence；全仓 80+ 处 import 子路径迁移；`scripts/prisma.sh` 的 `CORE_DIR`、apps/agent + apps/console + apps/browser 的 tsconfig 源码别名与 package.json 依赖、`.gitignore` 的 generated 路径同步更新；`packages/server-core` 整体删除（合并 master 的 `apps/browser` 独立进程后，其对 server-core 的引用一并迁移到 kernel/http/persistence）。**纯移动重构**：不改任何 DAO / config / logger 内部逻辑、不改 Prisma schema、运行时行为零变化（不触碰 system prompt / 工具描述 / 消息序列化格式，对 KV 缓存前缀无影响）。

## [0.3.2.2] - 2026-07-01

### Changed

- agent/browser: 把浏览器从 agent 进程内拆成独立 PM2 进程 `kagami-browser`（新包 `@kagami/browser`），让 `pnpm app:deploy agent` 重启 agent 时活的 Chromium / 登录会话不再被杀（见 [#173](https://github.com/KisinTheFlame/kagami/issues/173)）。新进程是 server-core-based 的 Fastify 服务，仅绑 `127.0.0.1`（API 暴露 `type secret_handle` / `eval` / `screenshot`，绝不对外网卡），把原 `BrowserService` / 错误体系 / 凭据 DAO 从 `apps/agent` 整体移入；agent 侧新增 `HttpBrowserClient` 逐一镜像 `BrowserService` 方法签名，8 个浏览器工具只把取数来源从进程内 service 换成 HTTP client，**tool_result 字节保持与拆分前逐字一致**（KV 缓存契约，由 golden 测试守住）。凭据：`type(secret_handle)` 在浏览器进程内直读 SQLite `browser_credential` 注入 fill 层，明文永不过 HTTP、永不回 agent。并发：所有动作经进程内 `SerialExecutor` 串行执行，保住 `observeEpoch` / pageStack / locator 不变量（不再依赖"调用方单线程"假设）。健壮性：client 用 `AbortSignal.timeout` + 把 `ECONNREFUSED` / 超时 / 非 JSON 响应统一映射成 `BROWSER_NOT_READY`；进程关停加 deadline 兜底；`waitFor` 死等毫秒数加上限防串行队列被永久占住。配置：顶层 `services` 块新增 `browser`（`127.0.0.1:20007`，同步 `config.loader` / `config.yaml.example`）；`server.apps.browser` 行为配置改由浏览器进程消费。部署：`ecosystem.config.cjs` 新增 `kagami-browser`（PM2 `cwd` 固定仓库根，让 `userDataDir` 落仓库根 `data/browser/`），`scripts/deploy.sh` 单服务分支加 `browser`、迁移暂停库进程列表纳入 `kagami-browser`；`app:deploy agent` 不再触及浏览器进程。无 DB schema 变更。**部署前置（部署机 gitignored `config.yaml`）：加 `services.browser` 块；一次性迁移 `mv apps/agent/data/browser data/browser` 把现存登录 profile 搬到仓库根，否则登录态不会跨重启续上。**

## [0.3.2.1] - 2026-07-01

### Changed

- web: 内置登录页把 **Claude Code** tab 排到 Codex 前面，并将所有默认入口（侧栏「内置登录」链接、`/auth` 重定向、非法 provider 兜底、页内重定向）统一指向 `/auth/claude-code`，使默认打开的就是 Claude Code tab。纯前端表现层改动，不涉及后端、API 或 Agent 上下文。

## [0.3.2.0] - 2026-06-30

### Changed

- web: 前端管理台整套美术风格重做为 **「晒褪了色的蒙德里安 / The Painted Ledger」**（蒙德里安骨架 + 文艺复兴/印象派颜料色）。刻意**弃用 shadcn 的有样式组件层与默认 slate 主题**，仅保留 `@radix-ui/*` 无样式行为基元（焦点陷阱、键盘可访问性），其余 class 体系与组件外观全部自定义。新增仓库根 `DESIGN.md` 作为设计源真理，`AGENTS.md` 增设计系统章节。
  - 配色：`index.css` 的 `:root` / `.dark` 改为颜料盘（HSL 通道，沿用 `hsl(var(--x))` + 透明度修饰符），新增 5 个语义颜料色（朱砂红=错误/主动事件、群青=LLM/context、赭黄=scheduler/等待、绿土=Story/记忆、茜草=高成本）+ 侧栏 token；深色为「夜间画室」明暗对照整套重设，非简单反相。
  - 字体：经 Google Fonts 加载 Fraunces/思源宋体（标题）、Literata/思源黑体（正文）、JetBrains Mono（数据）；结构边界默认 `border` 宽度提到 2px、`--radius` 归零、全局等宽数据 `tabular-nums`。
  - 组件：`button/card/table/badge/dialog/select/chart/json-panel/mobile-card` 与 layout（侧栏暖近黑画布边竖栏、列表/详情画框）按本系统重写；`AuthPage`、`LlmPlayground`、`MetricCharts` 等自带 slate/粉彩/玻璃拟态样式的页面并入颜料盘。
- web: 经 `/design-review`（Codex + opus 子 Agent 双路外部意见）走查并修复 11 项：暗色侧栏字标可读性、Playground 玻璃拟态块去渐变/圆角/阴影/blur、图表系列色去数字纯色、弱字/绿土文字色晒暗达 WCAG AA、结构层圆角统一 `rounded-none`、`focus-visible` 键盘焦点环统一、全局 `tabular-nums`、`prefers-reduced-motion` 门控、移动端触控目标抬到 ≥44px（仅移动断点，桌面密度不变）等。
  - 纯表现层改动，不涉及后端、API、数据流或 system prompt / 工具描述，对 KV 缓存前缀无影响。

## [0.3.1.17] - 2026-06-30

### Changed

- browser: 浏览器截图 JPEG 质量常量 `SCREENSHOT_JPEG_QUALITY` 由 `60` 提到 `85`，消除低质量 JPEG 在文字边缘的压缩噪点/块效应（实测「截图太糊」的主因）。视口分辨率不变（仍 `1024×768`、`deviceScaleFactor` 维持默认 1），故进多模态上下文的截图 token 占用基本不变，只是单张图字节略增。属 `BrowserService` 代码常量调整，不进 `config.yaml`（行为参数仍按 browser app 约定走代码常量）；不触碰 system prompt / 工具描述 / 消息序列化格式，对 KV 缓存前缀无影响。

## [0.3.1.16] - 2026-06-30

### Changed

- test(oss): `object-store.test.ts` 的「unlink 失败容错」用例在跑通时会把被测代码的 best-effort 容错日志（`console.error("unlink orphan blob failed: ...")`）连同完整 stack trace 裸喷到 stderr，看着像测试出错，实则用例 `✓` 通过、日志是预期行为。改为在该用例内 `vi.spyOn(console, "error")` 把这条日志收掉，并顺手加一条 `toHaveBeenCalledWith` 断言确认确实走了容错分支——既消除测试输出噪音，又把「我们是故意触发这个日志」显式化。纯测试改动，不碰生产代码与行为。

## [0.3.1.15] - 2026-06-30

### Changed

- deploy/config: 把散装根脚本 `scripts/web-server.mjs` 提升为一等公民 TS 包 `apps/gateway`（`@kagami/gateway`，零 `@kagami/*` 依赖、只依赖 `yaml`），并在 `config.yaml` 引入顶层 `services` 块作为**所有服务监听端口与地址的唯一事实来源**——每个进程（agent / console / gateway / oss）从 `config.yaml` 自读自己的端口与依赖服务地址，`ecosystem.config.cjs` 不再持有任何端口/地址 env（删 `kagami-console` 的 `PORT`、`kagami-web` 的 `PORT`/`API_TARGET`/`CONSOLE_TARGET`）。收敛前同一端口散落在 ecosystem / web-server.mjs / config.loader / 各 app 入口共 2~4 处（含两处隐蔽的 OAuth `publicBaseUrl` 默认），现在只在 `services` 块定义一次（见 [#162](https://github.com/KisinTheFlame/kagami/issues/162)）。`apps/gateway` 用 TS 重写 web-server 全部逻辑（静态托管 `apps/web/dist` + `/api/*` 按五个 console 前缀分流 + `/health`），行为等价，地址改读 `services`（复刻 `apps/oss` 的 config.yaml 定位算法）。`config.loader` 新增 `ServicesSchema`（顶层、与 `server` 平级）；agent 监听端口改读 `services.agent.port`，OAuth `publicBaseUrl` 改为可显式覆盖、缺省派生 `http://localhost:${services.gateway.port}`（host 固定 localhost：浏览器回调 origin ≠ reachable host）；`server.oss.baseUrl` 收敛为 `server.oss.enabled` 开关，OSS 地址由 `services.oss` 派生（presence/enabled 仍是启用开关，缺省=禁用优雅降级，语义不变）。PM2 进程 `kagami-web` → `kagami-gateway`：`scripts/deploy.sh` 全量与单服务路径都加幂等 `pm2 delete kagami-web` 兜底改名后旧进程残留占端口；`pnpm app:deploy <agent|console|gateway|oss>`，`web` 保留为 `gateway` 的已弃用别名。同步更新 AGENTS / ARCHITECTURE / README(.zh-CN) 与 `config.yaml.example`。纯结构重构，端口数字不变、无 DB 变更；**部署机的 gitignored `config.yaml` 需手动对齐新结构**（加 `services` 块、删 `server.port` 与顶层 `oss.port`、`server.oss.baseUrl` 改 `enabled`）才能启动

## [0.3.1.14] - 2026-06-30

### Changed

- 多包: 清理一轮代码审查发现的低危技术债（见 issue #163），单 PR 收口，逐条经 grep/read 核对位置。机械清理与行为修正分离，会把历史脏数据从「能跑」变成「启动即崩」的校验类改动一律 fail-soft。本批不触碰 system prompt 文案、工具描述、消息序列化格式/字段顺序，对 KV 缓存前缀无影响。
- web: 13 处本地 `formatDate`/`formatDateTime` 收敛到新建 `apps/web/src/lib/format.ts`（`formatDateTime` 非空语义 + `formatOptionalDateTime` 容忍 null/undefined/非法值）；`toStatusLabel` 两处（`LlmChatCallStatus` 版）合并到 `pages/llm-history/format-status.ts`。`ControlPanelPage`/`SchedulerTasksPage` 的 locale 默认格式 formatter 因展示文本不同而保留。
- web: `MetricChartsPage` 删除仅转发的 `getErrorMessage` wrapper，调用点直接用 `getApiErrorMessage`；`LlmPlaygroundPage` 错误展示改用 `getApiErrorMessage`，provider 切换校验候选 id（去裸断言、未知 id 不再使页面空白）。
- web: `SchedulerTasksPage` 列表 `key={index}` 改用稳定组合键；新增 class 版 `ErrorBoundary` 包裹 `AppLayout` 内容边界并随路由切换 reset。
- agent: `root-effect-interpreter` 三处 `effect as XxxEffect` 改用类型守卫（接口签名固定为基类 `Effect`，无法收窄参数）；`ContextGroupMessageEventItem` 重命名为 `ContextEventItem`（去 QQ 残留命名）；`event.ts` 中段 import 上移；`hn-reader` 重复的 isComment 判定抽出 `isCommentHit`；`vision-agent` 三处裸 `throw new Error` 统一为 `BizError`；`back-to-portal.tool.ts` 注释修正（状态树已退役）。
- packages: `prisma-metric.impl.dao.ts` 复用 `common/prisma-json.ts` 的 `toInputJsonObject`；`db/client.ts` 加注释说明 WAL/busy_timeout 两条 PRAGMA 不能合并（adapter prepared-statement 只执行首条）；`shared/schemas/auth.ts` 加注释标注 Claude Code usage API snake_case 字段勿改名。
- agent: `closeLlmProviders` 由 `Promise.all` 改 `Promise.allSettled`（单个失败不短路其余清理）；story 搜索 `topK` 加 `MAX_SEARCH_TOP_K=200` 上限（深翻页 capped，不抛错）；`tei-embedding-gemma-provider` 的 `fetch` 加 `AbortSignal.timeout(30s)`。
- console: `prisma-metric-chart.impl.dao.ts` 的 `aggregator` 枚举出参加类型守卫，脏值降级为默认 `"sum"` + warn（不抛 500）。

### Fixed

- agent: `prisma-app-state-store` 读出 `app_state` 时校验结构，非法持久化数据记 warn 并按「无状态」处理（返回 null 走首次初始化），避免坏数据导致启动/主流程崩溃。
- agent: `auth-usage-cache` 子进程 `waitForChildExit` 不再静默吞异常，真正异常退出记 warn（未登录/无 codex CLI/正常退出仍走正常分支不刷 error）。
- agent: QQ App 三处 `id as ConversationId` 收敛到 `toConversationId`，外部入口宽松校验、非规范 id 记 warn 后透传（不 throw，不拦截内部既有数据）。

## [0.3.1.13] - 2026-06-30

### Changed

- todos: `TODOS.md` 新增 `## napcat` 分组并记录一条 P3 已确诊的上游限制——「合并转发里小镜看不到自己的消息」。范围：在和小镜的私聊里选中**包含小镜自己发出的消息**生成合并转发再发给小镜，小镜 `view_forward` 展开时只看得到对方消息、看不到自己那部分。已 live 实测确诊（转发 `7656887019929762382` 实含 4 条＝闻震 2＋小镜 2，但 NapCat 经 `get_msg` / `get_forward_msg` 都只返回 2 条对方消息，小镜自己的 2 条不在返回里）：根因在 NapCat / NTQQ 数据层按 `resId` 重建转发时丢弃本账号自己的消息，self 节点在进入 NapCat 解析前就已不存在（NapCat 源码 `parseMultiMessageContent` / `parseMessageV2` 并不过滤 self），客户端无解、与我们的 `view_forward` 实现无关（[0.3.1.6] / [0.3.1.10] 已分别确认无关）。对路修法是上报 NapCat；本地不做脆弱的时间戳穿插拼接。纯文档，无代码改动

## [0.3.1.12] - 2026-06-30

### Changed

- agent/runtime: 修复 `InvokeTool` 顶层 dispatcher 的抽象泄漏——`buildInvokeSubtoolFailureMessage` 原本按错误码硬编码了两条 App 专属文案（`CHAT_CONTEXT_UNAVAILABLE` → "当前缺少可发消息的 QQ 会话上下文"、`ARTICLE_NOT_FOUND` → "当前 IT 之家列表中找不到该文章 ID"），把 QQ / IT 之家的业务概念塞进了"本身不知道任何 App"的稳定壳，违反"群聊只是众多生活输入之一、不应泄漏进 runtime 核心"的项目定位。改法：失败文案由各 App 自己的子工具随结果返回（`send_message` / `send_resource` 的无会话分支、`open_ithome_article` 的文章缺失分支各自带上 `message` 字段；`send_resource` 顺手把旧的 `note` 字段名统一成 `message`），`InvokeTool` 只负责原样透传子工具自带文案 + 追加该子工具的 schema 文档，不再按错误码合成 App 语义。保留结构性的 `INVALID_ARGUMENTS` 分支（那是 `ZodToolComponent` 的通用参数校验错误、非 App 概念）。纯重构：错误码与对 LLM 可见的提示内容不变，仅迁移文案的构造位置；不触碰稳定前缀（KV 缓存无影响）。新增 `open-ithome-article.tool.test.ts` 与 2 条 `invoke.tool` 回归测试，锁定"子工具自带文案被保留、被删的 App 硬编码不再由 InvokeTool 合成、结构性错误提示仍合成"这三条边界。

## [0.3.1.11] - 2026-06-30

### Changed

- llm/config: 把 LLM provider 标识字面量联合 `["deepseek", "openai", "openai-codex", "claude-code"]` 收敛到最底层 `@kagami/llm` 包单源（新增 `LLM_PROVIDER_IDS` 常量数组 + 派生 `LlmProviderId` 类型），消除原本散落 4 处的重复（server-core contracts 手写 type union、shared 的 `z.enum` + `z.infer`、config.loader 的 `z.enum ... satisfies`、agent client 的 `as const` 数组）——加 / 删 provider 从此只改一处，杜绝类型与 schema 漂移。shared 与 server-core 各新增一条对 `@kagami/llm` 的 workspace 依赖（均指向 DAG 最底层，无环）；因项目禁止 re-export barrel，所有 `LlmProviderId` 消费方（server-core config / 2 个 DAO、agent 的 llm / auth 共 6 个文件 + 1 个测试）改为直接从 `@kagami/llm` 导入。`@kagami/llm` 保持零 zod 依赖，需要校验的下游用 `z.enum(LLM_PROVIDER_IDS)` 自行派生。纯重构：provider 枚举值与顺序不变、配置校验行为不变、不触碰任何稳定前缀（KV 缓存无影响）。`LlmUsageId` 未动（其 type 本就单源）。

## [0.3.1.10] - 2026-06-30

### Fixed

- napcat: 修复部分合并转发用 `view_forward` 展开时显示「（合并转发为空或不可读）」——尤其是把「我和小镜的对话」截成转发再发回时常复现。根因有两层：① NapCat 对刚到达 / 内层是旧消息的转发，`get_forward_msg` 会**瞬时返回空**（内层尚未解析，稍候即有，已实测）；② 我们一次取空就**把空也缓存了 10 分钟**，等于把瞬时失败固化成 TTL 内永久失败。改法（参考规范客户端 node-napcat-ts 的读法，但保留我们的懒加载架构）：转发读取主路径改走 **`get_msg(forwardId)`**——容器消息的 forward 段自带内联 `content`，比 `get_forward_msg`（resId→getMsgHistory 多一跳）更稳；`get_msg` 拿不到内容再兜底 `get_forward_msg`；取到空就**重试 2~3 次带退避**，且**不缓存空结果**（raw 节点缓存与分页缓存均只在非空时写），让下次调用还能再试。转发内容仍只回到 tool result 尾部，绝不进稳定前缀（KV 缓存优先不变）。实测：之前「看不到」的转发现在经 get_msg 正常展开。仅改 `napcat-gateway.impl.service.ts` + 对应测试（新增 get_msg 主路径 / 回退 get_forward_msg / 重试不缓存空三个场景）

## [0.3.1.9] - 2026-06-30

### Changed

- agent: 把各 App 专属的屏幕渲染函数从共享的 `runtime/context/context-message-factory.ts` 下沉到各自 App 目录，消除 runtime 核心层对上层 App 与 napcat 的反向依赖（runtime 是被所有 App 依赖的最底层，原文件却反向 import 了 `apps/hn` 与 `napcat`，违反分层与「群聊概念只属于 messaging / QQ App」的约束）。HN 渲染迁入新建的 `apps/hn/hn-screen.ts`，IT之家渲染迁入 `apps/ithome/ithome-screen.ts`，QQ 群与私聊消息渲染（含 napcat 段渲染）迁入 `apps/qq/qq-message-render.ts`。`context-message-factory.ts` 只保留与具体业务无关的通用消息构造器（user、wake、portal、notification、story-recall、async-tool-result、摘要类），不再 import 任何 App 或 napcat。纯代码搬移：所有渲染函数逐字迁移，行为与序列化输出（各自的 XML 伪标签与 `.hbs` 模板）完全一致，对 KV 缓存前缀无影响；对应单测一并拆分到各 App 的测试目录，并补齐 QQ 私聊显示名 remark 优先于 nickname 再退到 userId 的回退单测

### Removed

- agent: 删除 6 个无任何调用方的死函数（`createIthomeArticleListMessage`、`createIthomeArticleDetailMessage`、`createMergedGroupMessagesMessage` 及其 `Content` 版本、`createMergedPrivateMessagesMessage` 及其 `Content` 版本），随本次下沉一并清理，不搬运死代码

## [0.3.1.8] - 2026-06-30

### Fixed

- web/metric-charts: 修复图表图例（legend）在序列过多时单行横向溢出、末项被截断的问题。共享图例组件 `ChartLegendContent`（`apps/web/src/components/ui/chart.tsx`）的容器原本是 `flex ... justify-center gap-4`，不换行，图例项一多就溢出卡片宽度。改为 `flex flex-wrap ... gap-x-4 gap-y-1.5`，图例项过多时自动换行并整体居中；recharts `Legend` 按自定义内容的真实 DOM 高度（含多行）测量并预留垂直空间，折线图不会被压住。该组件为 metric-charts 页所有图表共用，一并受益

## [0.3.1.7] - 2026-06-30

### Added

- todos: `TODOS.md` 新增一条「自动推荐可新增的待办事项」（P3，open，归入新建的 `## todo` 分组）。方向是让小镜在自己的生活里自发发现"值得做的事"并主动推荐进 todo App，而非只能被动记录别人交代的事，符合"给 Agent 的生活添一种新的存在方式"的定位。Context/Notes 已写明待想清楚的点：推荐触发时机（空闲后台动作 vs 事件后）、内容来源（近期对话 / 新闻 / 未完话题）、去重防噪，以及 KV 缓存红线——推荐过程的中间素材走子 Agent / Operation 只回候选摘要，不进主上下文

## [0.3.1.6] - 2026-06-29

### Changed

- napcat: `get_forward_msg`（view_forward 子工具底层）的请求/返回契约对齐规范 TS 客户端 [node-napcat-ts](https://github.com/HkTeamX/node-napcat-ts)（已核对最新 `origin/main`）。请求参数从 `{ id, message_id }` 收敛为 `{ message_id }`——NapCat 内部 `payload.message_id || payload.id`，多带的 `id` 本就被忽略，纯冗余；返回 schema 删掉不存在的 `message`（单数）兜底字段，只留 `messages`，节点提取相应改为 `messages ?? []`。纯整洁性收敛，行为与对齐前完全一致：**不修复**「旧合并转发展开为空/不可读」——那是 NapCat 侧时效限制（转发 id 实为内部 msgId，`get_forward_msg` 回进程内 5000 条 LRU 捞原消息，消息被挤出/重启丢失即解析不出），与客户端调用方式无关。改动仅 `napcat-gateway.impl.service.ts` 一处 + 对应测试断言

## [0.3.1.5] - 2026-06-29

### Changed

- deploy: 把上一版（0.3.1.4）的独立 `app:restart` 命令**收进 `app:deploy` 的可选服务参数**，少记一个命令。`pnpm app:deploy`（无参）= 全量：构建 + 迁移 + 重载所有进程；`pnpm app:deploy <agent|console|web|oss>`（带服务名）= 只重建并重载该服务、不跑迁移、不动其它进程。语义更顺：deploy 不带参就是「整体上线」，带服务名就是「只重启那一个」。单服务路径的价值不变——重载 console / web 不打断 `kagami-agent` 的热状态（KV 前缀 / HNSW / 活内存），合 KV 缓存优先。删除 `scripts/restart.sh` 与 `app:restart` script 入口，逻辑合进 `scripts/deploy.sh`：带参分支 `pnpm --filter "@kagami/<svc>..." build` + `pm2 startOrReload ecosystem.config.cjs --only kagami-<svc>`，无参分支保留原有全量构建 + 迁移（含 WAL 锁规避）逻辑

## [0.3.1.4] - 2026-06-29

### Added

- deploy: 新增 `pnpm app:restart <agent|console|web|oss>`——只重建并重载单个服务进程，不动其它进程、不跑 Prisma 迁移。补上 `app:deploy`（重载全部）与 `app:stop`（停全部）之间缺的「单服务」粒度。核心价值贴合**KV 缓存优先**：只改了前端 / console 时 `pnpm app:restart console` 仅重载 console，`kagami-agent` 的热状态（KV 前缀、HNSW 索引、活内存上下文）完全不被打断（已实测：reload console 时 agent 的 uptime 持续增长、重启数不变）。实现 `scripts/restart.sh`：把服务名映射到包名与 PM2 进程名，`pnpm --filter "@kagami/<svc>..." build` 只重建该服务及其依赖包，再 `pm2 startOrReload ecosystem.config.cjs --only kagami-<svc> --update-env` 收口到单进程（进程不在跑则按 ecosystem 配置启动）。非法服务名打印用法并退出。涉及 DB schema 变更仍需走 `pnpm app:deploy`（它会跑迁移）

## [0.3.1.3] - 2026-06-29

### Fixed

- qq: 修 `send_resource` **一直报「没有打开的会话」**、即便已 `open_conversation` 也发不出图。根因是合并期的语义分叉：`send_message` 在另一条线上被重构为「执行时实时回调 `getChatTarget()` 读 QqApp 当前会话」并**从主 Agent 每轮的 `toolContext` 移除了 `chatTarget`**（chatTarget 是 QQ 私有概念、不经 session）；而 `send_resource` 落地时抄的是旧写法——读 `context.chatTarget`，合并后该字段恒为 `undefined`，于是无论是否打开会话都判定为「没有会话」。改为与 `send_message` 一致：`SendResourceTool` 注入 `getChatTarget` 回调（`qq-app.factory.ts` 用 `() => qqAppRef.current?.getCurrentChatTarget()` 注入），执行时实时读当前会话目标，不再依赖 `ToolContext`。补回归测试：往 `ToolContext` 塞一个会误导的 `chatTarget`，断言工具忽略它、只认实时回调值——锁死「不读 context」这条契约，防止再次退回旧写法

## [0.3.1.2] - 2026-06-29

### Changed

- agent: 把后端主进程从 `@kagami/server` 改名为 `@kagami/agent`（目录 `apps/server` → `apps/agent`、PM2 进程 `kagami-server` → `kagami-agent`），让命名与「这个进程就是 Agent 本体」的定位一致——console 拆出后，server 进程已纯粹是 Agent 生活运行时。**纯机械改名、零行为变化**：apps/agent 是 leaf app（仓库内无任何 `import ... from "@kagami/server"`），内部相对 import 与 tsconfig 源码 path 随目录移动自洽。同步改 `ecosystem.config.cjs`（name / cwd）、`scripts/deploy.sh`（停写库进程的进程名）、`eslint.config.mjs`（类型感知 glob `apps/agent/src/**`）、`.prettierignore`（`apps/agent/static/*.hbs` 忽略路径）、`apps/agent` 的 `pretest` filter，以及 AGENTS / ARCHITECTURE / README / README.zh-CN / effect-model 的结构化引用（顺手把 AGENTS 里 `config.loader` 的过期路径改正到 `packages/server-core`）。`scripts/web-server.mjs` 用端口不用进程名、不动；CHANGELOG 历史条目不改写。部署时 PM2 改名需一次性 `pm2 delete kagami-server` 再起 `kagami-agent`（端口 `20003` 不变）。下一步若做「console 单一前门 + 代理活操作」则另议——目前 web-server 按前缀分流已达成单一入口且故障隔离更好（console 挂不影响活操作）

## [0.3.1.1] - 2026-06-29

### Fixed

- deploy: 修 `pnpm app:deploy` 在 console 拆分后**卡在 Prisma 迁移步**报 `database is locked`、无法部署。根因：拆出 `kagami-console` 后有两个后端进程（`kagami-server` + `kagami-console`）持有同一个 WAL SQLite 库，而 `prisma migrate deploy` 的 schema engine 用独立连接、不带 busy_timeout，初始化 `_prisma_migrations` 时抢不到锁即直接失败（拆分前只有 server 一个进程时还能挤进去）。`scripts/deploy.sh` 改为先 `db:migrate:status`（只读，WAL 下与运行进程并存无碍）判断：无待应用迁移（绝大多数部署）直接跳过 `migrate deploy`、零停机；确有待应用迁移时先 `pm2 stop kagami-server kagami-console` 腾出独占访问再迁，且迁移失败也立刻把进程拉回来再中止、绝不留下停机的 agent，Step 3 的 `startOrReload` 照常重载。失败的迁移在碰 PM2 前 abort，不影响运行中的进程（[#146](https://github.com/KisinTheFlame/kagami/pull/146) 的部署副作用修复）

## [0.3.1.0] - 2026-06-29

### Changed

- agent: 把 **send_message 的发送目标（当前聊天会话）** 从 `RootAgentSession` 收归 QQ App——chatTarget 是 QQ 私有概念，不该泄漏进通用 session。`RootAgentSession` 删掉 `chatTargetProvider` / `getCurrentChatTarget` / `getCurrentGroupId`；`send_message`（QQ App 自己的子工具）改从构造期注入的 `getChatTarget` provider 取目标——在 `qq-app.factory.ts` 用局部 forward-ref 接到 `qqApp.getCurrentChatTarget()`（与文件里既有的 inbound holder 同套路就地解环），`createRoundInput` 不再往 toolContext 塞 `chatTarget`。同时**移除 `search_web` 的「必须在活跃 QQ 会话里」门控**：这道门控把通用联网能力错误耦合到 QQ 焦点，与「Agent as a life」定位冲突，而 web-search task agent 本就只消费 `systemPrompt`+`contextMessages`、从不读 chatTarget。移除后小镜在 Portal 或任意 App 里都能联网搜，只在真正拿不到上下文时返回 `CONTEXT_UNAVAILABLE`，且 `search_web` 不再依赖 `rootAgentSession`。在 master 落地异步工具原语（#141 把 `search_web` 重构为 `createSearchWebTool`/`prepareSearchWeb`）之上重新应用：门控移除落在 `prepareSearchWeb`，异步装配不变。两处改动对主 Agent 稳定前缀与 KV 缓存中性（顶层工具集字节不变）

### Removed

- agent: 退役**手机 OS 状态树遗留代码 + sessionSnapshot 持久化空壳**。状态树早已退化为 App 启动器（`focusedStateId` 恒 `"portal"`、`stateStack` 恒 `["portal"]`），相关方法 `getState` / `getFocusedStateId` / `getStateView` / `getAvailableInvokeTools` / 类型 `RootAgentSessionState` / `RootAgentSessionStateView` 与 runtime 的 `getSessionState` 全是零引用死代码，一并删除。`session.restorePersistedSnapshot(snapshot)` 早已退化成只搬运空壳，改为无参 `markRestored()`——**保留关键副作用**：恢复后置 `initialized=true`，使后续 `initializeContext` 成 no-op、不重复追加 portal reminder 破坏 KV 前缀（`reset()` 反向置 `false`，两条路径各有单测断言）。在 master #147（删快照 schema 的 napcat legacy 子字段、持久化层脱 QQ 类型）基础上更进一步：`sessionSnapshot` 整体只装恒定 `{stateStack:["portal"]}` 且 restore 时被完全忽略，从 Zod schema / 子 schema / runtime 组装 / 快照指纹 / Prisma 读写整条移除，`schemaVersion` 3→4，并配套 Prisma 迁移 drop 掉 `root_agent_runtime_snapshot.session_snapshot`（NOT NULL JSON 列，SQLite 标准表重建，`INSERT...SELECT` 保留其余列与唯一索引、无数据丢失）。旧 v3 快照前向兼容：load 不 gate 版本、只读仍存在的 `contextSnapshot`，恢复后下次 save 自然写回 v4

## [0.3.0.1] - 2026-06-29

### Changed

- docs: 文档同步 server-core 包与 Prisma 路径，修正依赖图。承接 [#149](https://github.com/KisinTheFlame/kagami/pull/149)（已补全 zh-CN/AGENTS/ARCHITECTURE 的八包列表），收口其未覆盖的三处真实漂移：(1) `README.md`（英文）#149 未触及，仍写 six packages，补到 eight 并在包列表与目录树补 `apps/console`、`packages/server-core`；(2) Prisma 路径——四个文档里 `apps/server/prisma/*` 全过期，schema 与 migrations 实际在 `packages/server-core/prisma/*`（见 `scripts/prisma.sh` 的 `CORE_DIR`），四处全改正；(3) `ARCHITECTURE.md` 依赖图——`@kagami/llm` 零 `@kagami` 依赖，删掉错误的 `llm ──→ shared` 箭头使图与真实 DAG 一致。纯文档、无源码改动（[#151](https://github.com/KisinTheFlame/kagami/pull/151)）

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
