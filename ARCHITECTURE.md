# Architecture

本文档描述 Kagami 仓库的代码组织、模块依赖与关键设计决策。项目理念（Agent as a life）见 [README](./README.md)；面向 LLM agent 的协作指引见 [AGENTS.md](./AGENTS.md)。

## Workspace 拓扑

pnpm workspace 由 4 个包组成，依赖关系单向（apps → packages）：

```
apps/server  ─┐
              ├──→  packages/agent-runtime  ──→  packages/shared
apps/web    ──┘                                 ↑
                                                │
                       apps/web ────────────────┘
```

| 包                      | 角色                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@kagami/server`        | Fastify 后端、Agent 业务装配、NapCat 网关、HTTP/ops 接口、Prisma DAO                                        |
| `@kagami/web`           | React 19 + Vite 管理台                                                                                      |
| `@kagami/agent-runtime` | 与 Kagami 项目语义无关的通用 Agent 内核（AgentRuntime / TaskAgentRuntime / Operation / Tool / ToolCatalog） |
| `@kagami/shared`        | Zod schema、DTO、前后端共用工具                                                                             |

## 后端模块 DAG

后端采用「扁平模块 + 模块内分层」结构，顶层目录直接位于 `apps/server/src/<module>`，模块按 DAG 单向依赖。

```
                       app                        最高层装配：Fastify 注册、模块 wiring、启动补水
                        │
        ┌───────────────┼───────────────┐
        ↓               ↓               ↓
       ops          agent           napcat       业务/能力层
        │               │               │
        └──────┬────────┴──────┬────────┘
               ↓               ↓
              llm           news / metric
               │
        auth / logger / db / config
                       │
                     common         无业务语义的公共契约 / errors / http helper / runtime utils
```

每个模块内部按需分层：

- `domain/` — 实体、值对象、模块内 port、纯规则
- `application/` — use case / service / query / command
- `infra/` — Prisma、HTTP、外部系统适配
- `http/` — Fastify handler 与路由注册

非每个模块都补全四层；以实际复杂度为准。模块之间禁止循环依赖。

### 关键模块速览

| 模块        | 职责                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `common`    | `BizError`、`toHttpErrorResponse`、`registerQueryRoute` / `registerParamRoute` 等路由 helper、跨模块契约 |
| `config`    | `config.yaml` 加载、Zod 校验、运行时配置管理                                                             |
| `db`        | Prisma client、事务封装                                                                                  |
| `auth`      | OAuth（Claude Code / Codex 等）回调、secret store、usage cache / trend                                   |
| `llm`       | LLM provider 封装、chat client、embedding、调用历史 DAO                                                  |
| `napcat`    | NapCat gateway、入站事件归一化、消息发送                                                                 |
| `news`      | RSS 等资讯源轮询，给 Agent 提供「读新闻」这种生活输入                                                    |
| `metric`    | 运行时指标采集与可视化数据接口                                                                           |
| `agent`     | Kagami 业务层：RootAgent、capabilities、事件适配、上下文压缩、Story 记忆、RAG                            |
| `ops`       | 后台观测接口：app-log、llm-chat-call、embedding-cache、Story、Agent Dashboard、napcat history            |
| `scheduler` | 后台定时任务（数据保留清理等）                                                                           |
| `app`       | 模块装配、Fastify 路由注册、健康检查、启动上下文补水                                                     |

### Agent 子结构

```
apps/server/src/agent/
├── runtime/          Kagami 定制运行时：RootAgentRuntime、session、事件队列、上下文渲染
├── capabilities/     按能力聚合的实现
│   ├── messaging/      QQ 群消息收发（NapCat 是事件源，不向 runtime 泄漏）
│   ├── story/          长期记忆 / RAG 检索 / Story 写入
│   ├── news/           RSS 抓取、文章阅读
│   ├── vision/         图片理解
│   ├── web-search/     独立子 Agent，多轮搜索结果只回传摘要
│   ├── context-summary/ 上下文压缩 Operation（唯一允许 replaceMessages 的路径）
│   └── terminal/       终端能力 App
└── apps/             App 框架（Per-App config schema 自注册）
```

通用 Agent Runtime 内核位于 `packages/agent-runtime`；Kagami 项目语义不下沉到该包。

## 前端结构

```
apps/web/src/
├── pages/
│   ├── agent-dashboard/         默认入口，Agent 总览
│   ├── auth/                    OAuth 与配额
│   ├── llm-playground/          手工触发 LLM 调用
│   ├── llm-history/             LLM 调用历史
│   ├── app-log-history/         应用日志
│   ├── napcat-event-history/    NapCat 事件
│   ├── napcat-group-message-history/  群消息
│   ├── story-history/           Story 记忆
│   ├── main-agent-context/      主 Agent 当前上下文
│   ├── metric-charts/           运行时指标图表
│   └── scheduler-tasks/         后台任务面板
├── components/layout/           跨页面布局（HistoryListPageLayout、MobileDetailHeader 等）
├── components/ui/               基于 shadcn 的原子组件
└── lib/                         api 客户端、query keys、工具
```

技术栈：React 19、React Router、TanStack Query 5、Tailwind 3、shadcn。组件优先用 shadcn，缺失时通过 shadcn CLI 引入。

## 数据流与生命周期

### 输入：事件源

Agent 不区分输入来源；所有外部信号都归一为「生活输入」：

```
NapCat 群消息 ─┐
RSS 轮询      ─┼─→  事件队列  ─→  RootAgentRuntime  ─→  ReAct 循环  ─→  Tool 调用 / 输出
定时任务       │
系统通知       ─┘
```

`messaging`、`news`、`scheduler` 等模块负责把各自的事件归一为内部事件结构投入队列。runtime 不知道也不应该知道它们的具体协议。

### 推理：稳定前缀 + 易变尾部

LLM 消息列表分三段：

1. **稳定前缀** — system prompt、工具定义、历史对话。只追加，不修改。
2. **易变尾部** — 当轮新事件、召回注入、tool result。可变但只影响最后一段。
3. **计划性重建** — 仅上下文压缩允许 `replaceMessages`，一次性把旧前缀换成更短的新前缀，作为新的稳定前缀继续生长。

对应到代码：`AgentContext` 只暴露两个消息变更入口：`appendMessages`（保留前缀）与 `replaceMessages`（明确破坏前缀）。

### 工具系统：InvokeTool 顶层壳

LLM API 暴露的顶层 tools 集合永远只包含少量结构性元能力（`enter` / `back-to-portal` / `wait` / `invoke` / `help`），不随 capability / App 数量增长。具体能力通过 `invoke(name, args)` 间接调用，可选 App 模式下还可通过 `enter(<appId>)` + `help` 在运行时按需披露子工具。

设计目的：避免新增能力让顶层 tools 列表变化、把 KV 缓存命中率降到零。详见 AGENTS.md「开发原则：KV 缓存命中率优先」。

## 持久化

- **PostgreSQL**（生产 / 开发统一）通过 Prisma ORM 访问
- Schema 源文件 `apps/server/prisma/schema.prisma`，迁移落在 `apps/server/prisma/migrations/`
- 通过 `pnpm db:migrate:dev` / `db:migrate:deploy` 管理
- DAO 接口定义在模块内 `dao/`，实现在 `dao/impl/`

## HTTP 接口入口

| 类别            | 路径                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 健康检查        | `/health`                                                                                                                            |
| OAuth / 配额    | `/auth/:provider/status` \| `login-url` \| `logout` \| `refresh` \| `usage-limits` \| `usage-trend`                                  |
| LLM Playground  | `/llm/providers`、`/llm/playground-tools`、`/llm/chat`                                                                               |
| NapCat 主动发送 | `/napcat/group/send`                                                                                                                 |
| 观测查询        | `/app-log/query`、`/llm-chat-call/query`、`/llm-chat-call/:id`、`/napcat-event/query`、`/napcat-group-message/query`、`/story/query` |
| Agent / 指标    | `/agent-dashboard/*`、`/main-agent-context/recent`、`/metric-chart/*`                                                                |

## 部署

- PM2（`ecosystem.config.cjs`）托管两个进程：`kagami-server`（Fastify，默认 20003）+ `kagami-web`（静态 + 反代 `/api/*`，默认 20004）
- `pnpm app:deploy` 串起 build → Prisma migrate deploy → PM2 reload → `pm2 save`
- PostgreSQL 与 NapCat 作为宿主机外部依赖运行；`config.yaml` 一般用 `localhost` 访问

## 进一步阅读

- [README.md](./README.md) — 项目理念与使用入口
- [AGENTS.md](./AGENTS.md) — 面向 LLM agent 的协作指引（KV 缓存优先、capability 设计原则、代码规范、命令清单）
- [CHANGELOG.md](./CHANGELOG.md) — 变更记录
- [TODOS.md](./TODOS.md) — 待办清单
