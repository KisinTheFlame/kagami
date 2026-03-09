# 指示

## 项目简介

Kagami 是一个基于 pnpm Monorepo 的全栈 TypeScript 项目，包含三个工作空间包：

- `apps/server` — Fastify 后端服务（`@kagami/server`）
- `apps/web` — React 前端应用（`@kagami/web`）
- `packages/shared` — 前后端共享的类型与工具（`@kagami/shared`）

## 常用命令

### 构建部署

```bash
pnpm build # 构建所有包（顺序执行，shared → server/web）
pnpm typecheck # 对所有包执行 TypeScript 类型检查
pnpm app:deploy # 标准发布链路：build -> prisma migrate deploy -> PM2 reload
```

### 代码质量

```bash
pnpm lint # ESLint 检查
pnpm lint:fix # ESLint 自动修复
pnpm format # Prettier 格式检查
pnpm format:write # Prettier 自动格式化
```

### 数据库（在仓库根目录执行，直接连接 config.yaml 中的数据库）

```bash
pnpm db:migrate:dev -- --name <migration_name> # 在本机数据库生成迁移（create-only，落盘到仓库）
pnpm db:migrate:deploy # 部署/上线时应用已有迁移
pnpm db:migrate:status # 查看迁移状态
pnpm db:migrate:reset # 重置数据库（危险）
pnpm db:migrate:resolve -- --applied <migration_id> # 标记迁移已应用
```

约束：数据库相关命令统一读取仓库根目录 `config.yaml` 中的 `server.databaseUrl`。

数据库变更流程：

1. 修改 `apps/server/prisma/schema.prisma`。
2. 在本地执行 `pnpm db:migrate:dev -- --name <migration_name>`（脚本会自动补上 `--create-only`，使用 `config.yaml` 指向的数据库生成新迁移）。
3. 提交 `prisma/migrations/*` 与 schema 变更。
4. 通过 `pnpm db:migrate:deploy`（或 `pnpm app:deploy` 内置步骤）将迁移应用到目标数据库。

已有数据库接入 Prisma Migrate（基线）：

1. 如果数据库结构已与当前 schema 对齐，先执行  
   `pnpm db:migrate:resolve -- --applied <baseline_migration_id>`  
   避免重复建表。
2. 后续按标准流程使用 `db:migrate:dev`（生成）和 `db:migrate:deploy`（应用）。

### 针对单个包执行命令

```bash
pnpm --filter @kagami/server <script>
pnpm --filter @kagami/web <script>
pnpm --filter @kagami/shared <script>
```

## 开发规约

每次开发完成后，执行：

```sh
pnpm build # 构建所有包（顺序执行，shared → server/web）
pnpm typecheck # 对所有包执行 TypeScript 类型检查
pnpm lint # ESLint 检查
pnpm format # Prettier 格式检查
```

需保证均成功。

## 代码规范

### Prettier

- 双引号（`singleQuote: false`）
- 分号（`semi: true`）
- 缩进 2 空格
- 行宽 100 字符
- 尾逗号（`trailingComma: "all"`）

### TypeScript

所有包继承 `tsconfig.base.json`，开启 `strict: true`。

- 后端使用 `moduleResolution: NodeNext`
- 前端使用 `moduleResolution: Bundler`
- 前端额外开启 `noUnusedLocals` 和 `noUnusedParameters`

路径别名：

- `@kagami/shared` 在前后端均映射到 `packages/shared/src/index.ts`（开发时直接引用源码）
- 前端额外有 `@/*` 映射到 `apps/web/src/*`

### ESLint

- 忽略 `dist/`、`build/`、`node_modules/`、`prisma/generated/`
- 前端应用应用 `react-hooks` 和 `react-refresh` 规则

## 架构要点

### 后端服务（@kagami/server）

后端采用事件驱动的 agent 循环架构，核心模块分布如下：

- `agent/` — agent 循环、上下文管理、事件队列、工具定义
- `dao/` — 数据访问层接口，实现在 `dao/impl/`（DAO 模式）
- `db/` — Prisma 客户端
- `handler/` — Fastify 路由注册（各模块一个 handler）
- `llm/` — LLM 客户端封装、provider 适配（DeepSeek / OpenAI）、类型与错误定义

构造函数统一使用对象参数风格（`{ dep1, dep2 }`）。

### 共享库（@kagami/shared）

`packages/shared` 是前后端共用 Zod Schema 和工具函数的核心。
Zod 本身也从此包再导出（`export { z } from "zod"`），业务代码统一从 `@kagami/shared` 导入 Zod。

### 前端 API 代理

生产环境中，PM2 托管的 Node 静态服务会将 `/api/*` 请求代理到后端 `http://localhost:20003/*`。
开发时需在 Vite 配置中手动设置代理规则（如有需要）。

### 环境变量

后端启动时通过 `apps/server/src/config/config.loader.ts` 读取并校验根目录 `config.yaml`。

### PM2 部署

- PM2 配置文件位于仓库根目录 `ecosystem.config.cjs`。
- 后端（`kagami-server`）：单进程 `fork` 模式运行 `apps/server/dist/index.js`，默认监听 **20003**。
- 前端（`kagami-web`）：单进程 Node 静态服务托管 `apps/web/dist`，默认监听 **20004**，并代理 `/api/*`。
- PostgreSQL 与 napcat 作为宿主机外部依赖运行，`config.yaml` 中应使用 `localhost` 地址访问。
