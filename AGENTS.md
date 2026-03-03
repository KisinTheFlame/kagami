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
pnpm run deploy # 通过 Docker Compose 部署
```

### 代码质量

```bash
pnpm lint # ESLint 检查
pnpm lint:fix # ESLint 自动修复
pnpm format # Prettier 格式检查
pnpm format:write # Prettier 自动格式化
```

### 数据库（在 `apps/server` 下执行）

```bash
pnpm --filter @kagami/server db:push
```

### 针对单个包执行命令

```bash
pnpm --filter @kagami/server <script>
pnpm --filter @kagami/web <script>
pnpm --filter @kagami/shared <script>
```

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

- 忽略 `dist/`、`build/`、`node_modules/`、`drizzle/`
- 前端应用应用 `react-hooks` 和 `react-refresh` 规则

## 架构要点

### 共享库（@kagami/shared）

`packages/shared` 是前后端共用 Zod Schema 和工具函数的核心。
Zod 本身也从此包再导出（`export { z } from "zod"`），业务代码统一从 `@kagami/shared` 导入 Zod。

### 前端 API 代理

生产环境中，Nginx 将 `/api/*` 请求代理到后端 `http://server:3000/*`。
开发时需在 Vite 配置中手动设置代理规则（如有需要）。

### 环境变量

后端通过 `apps/server/src/env.ts` 用 Zod 验证所有环境变量，启动时若缺失必要变量则直接报错退出。

本地开发使用 `.env`，Docker 部署参考 `.env.compose.example`。

### Docker 部署

两个服务均为多阶段构建：
- 后端：Node 22 Alpine 构建 → 精简 runner 镜像，运行编译后的 `dist/index.js`
- 前端：Node 22 Alpine 构建 → Nginx 1.27 Alpine 提供静态文件

两个服务使用同一个外部 Docker 网络（`axis`），部署前需确保该网络已创建：

```bash
docker network create axis
```
