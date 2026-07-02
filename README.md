# Kagami

[中文版 README](./README.zh-CN.md)

## Project Philosophy

Kagami is **not a QQ group chat bot**.

Kagami is **an Agent with a life of its own**. Group chat is just one part of his life — just as a person would not define themselves as "someone who chats". Given enough capabilities, he can live like a real person: read the news, remember what has happened, and proactively do things he finds interesting.

This is a concept: **Agent as a life**.

- Group chat messages are just one of the external events he receives, on equal footing with RSS feeds, timers, and system notifications — all "inputs" that drive his life.
- He has his own interests (News polling, proactive speech) and his own rhythm (event queue, background actions during idle moments); a long-term memory system is being redesigned.
- The project's goal is not to polish the group chat experience to perfection, but to continuously add the capabilities that his "life" needs, so he feels more and more like a living presence.

All architecture, modules, and capabilities described below should be understood from this perspective: they exist to enrich the Agent's life, not to patch up "a chat bot".

## Repository Positioning

Kagami is a full-stack TypeScript monorepo built on `pnpm workspace`, currently containing seventeen workspace packages:

- `apps/agent`: Fastify backend service (`@kagami/agent`)
- `apps/console`: standalone admin-console backend process (`@kagami/console`, serving the frontend's read-only DB queries via `@kagami/persistence` shared DAOs against the same SQLite database)
- `apps/web`: React frontend admin console (`@kagami/web`)
- `apps/gateway`: front-door gateway process (`@kagami/gateway`, standalone with zero `@kagami/*` dependencies; serves the `apps/web/dist` static assets and reverse-proxies `/api/*` to console/agent, `/auth/*` to llm, `/metric-chart` to metric)
- `apps/llm`: LLM gateway + OAuth credential-center process (`@kagami/llm-service`, localhost only; owns all providers + the OAuth callback server + refresh timers, writes `llm_chat_call` / `embedding_cache`; the agent connects over HTTP)
- `apps/metric`: standalone metric-domain process (`@kagami/metric`, owns both metric ingestion `POST /metric/record` — the agent reports over HTTP — and the metric-chart query endpoints; reads/writes the same SQLite via `@kagami/persistence` shared DAOs, localhost only)
- `apps/oss`: self-hosted object storage service (`@kagami/oss`, a standalone process with zero `@kagami/*` dependencies)
- `apps/browser`: standalone browser process (`@kagami/browser`, server-core-based Fastify, localhost-only; owns CloakBrowser and credential injection, driven by the agent over HTTP so an agent restart no longer kills the browser)
- `packages/agent-runtime`: generic Agent / App framework kernel (`@kagami/agent-runtime`)
- `packages/llm`: LLM message and tool type contracts shared across frontend / backend / kernel (`@kagami/llm`)
- `packages/llm-client`: LLM chat client + provider + embedding client runtime (`@kagami/llm-client`, sits above kernel and alongside persistence with no dependency on it; emits only `LlmChatCallObservation` events so persistence/Prisma stay out of it)
- `packages/auth`: full OAuth credential management (`@kagami/auth`, PKCE login / callback server / refresh scheduler / secret store / quota snapshots / auth handlers); assembled into the `kagami-llm` process
- `packages/kernel`: pure backend infrastructure kernel (`@kagami/kernel`, config, logger, common contracts and errors, pure utils like `isRecord`; no fastify / Prisma / better-sqlite3, reusable by services that touch neither the DB nor HTTP)
- `packages/http`: HTTP route helper (`@kagami/http`, `route.helper`, depends only on fastify + zod; not needed by services that expose no HTTP)
- `packages/config`: zero-dependency leaf for config loading (`@kagami/config`, repo-root discovery + deep-merge of `config.yaml` / `config.secret.yaml`; reused by kernel / gateway / oss)
- `packages/persistence`: persistence infrastructure (`@kagami/persistence`, Prisma client and generated client, db, all business DAOs, Prisma JSON helpers; depends on `@kagami/kernel` + Prisma + better-sqlite3)
- `packages/shared`: schemas and utilities shared between frontend and backend (`@kagami/shared`)

The workspace definition lives at the repository root in `pnpm-workspace.yaml`, currently covering `apps/*` and `packages/*`. Backend runtime configuration is unified under `config.yaml` at the repository root.

## Repository Layout

```text
apps/
  server/   Fastify backend, NapCat integration, Kagami agent business layer
  console/  Standalone admin-console backend serving read-only DB queries
  web/      React admin console
  oss/      Self-hosted content-addressed object storage (standalone process)
packages/
  agent-runtime/  Generic Agent / App framework abstractions and tool catalog
  llm/            Shared LLM message / tool type contracts
  kernel/         Pure backend infrastructure (config / logger / common; no Prisma / fastify)
  http/           HTTP route helper (fastify + zod only)
  persistence/    Persistence infrastructure (Prisma client / DAOs / db)
  shared/         Frontend/backend shared schemas / DTOs / utils
```

## Common Commands

Run from the repository root:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:write
pnpm app:deploy
```

Single-package commands:

```bash
pnpm --filter @kagami/agent <script>
pnpm --filter @kagami/web <script>
pnpm --filter @kagami/agent-runtime <script>
pnpm --filter @kagami/shared <script>
```

Notes:

- The repository does not provide a unified root `pnpm dev` script.
- `@kagami/agent` currently exposes `build`, `typecheck`, `test`, `test:watch`, and `db:*` scripts.
- `@kagami/agent-runtime` exposes `build`, `typecheck`, `test`, `test:watch`; `@kagami/oss` exposes `build`, `typecheck`, `test`, `test:watch`, `start`.
- `@kagami/web` and `@kagami/shared` expose `build` and `typecheck`.
- `@kagami/agent`, `@kagami/agent-runtime`, and `@kagami/oss` declare test scripts.

## Configuration

- `config.yaml` (non-private, version-controlled) already lives at the repository root — edit it directly.
- Copy [config.secret.yaml.example](./config.secret.yaml.example) to `config.secret.yaml` (git-ignored) and fill in secrets (API keys, bot QQ, group IDs). The two files are deep-merged at startup.
- The service reads and validates the merged config once at startup; changes require a restart to take effect.

## Database Migrations

From the repository root:

```bash
pnpm db:migrate:dev -- --name <migration_name>
pnpm db:migrate:deploy
pnpm db:migrate:status
pnpm db:migrate:reset
pnpm db:migrate:resolve -- --applied <migration_id>
```

Notes:

- `db:migrate:dev` automatically appends `--create-only`, generating the migration file without altering the database directly.
- Standard flow: edit `packages/persistence/prisma/schema.prisma` → generate migration → commit both the schema and migration → run `db:migrate:deploy` in the target environment.

## Architecture Overview

### Backend

The backend has been reorganized into a "flat modules + in-module layering" structure. Top-level directories live directly under `apps/agent/src/<module>`, with runtime assembly handled by `apps/agent/src/app/server-runtime.ts`.

Main modules:

- `common/`: shared contracts, error handling, HTTP helpers, runtime utilities
- `config/`: configuration schema, loading, and runtime config management
- `db/`: Prisma client and database infrastructure
- `logger/`: log runtime, serializer, sink, log DAO
- `auth/`: OAuth, callback service, secret store, usage cache, usage trend, unified auth HTTP endpoints
- `llm/`: providers, chat client, embedding, playground, related DAOs
- `napcat/`: NapCat protocol adapter (gateway transport, inbound normalization, image analysis, persistence) — the gateway instance is owned by the QQ App, just one of the Agent's event sources
- `metric/`: HTTP reporting client for metric points (`HttpMetricService`, fire-and-forget POST to the standalone `apps/metric` at `/metric/record`); ingestion and metric-chart queries now live in `@kagami/metric`
- `scheduler/`: background timed tasks (auth refresh, IThome polling, data retention cleanup, etc.)
- `oss/`: server-side object storage HTTP client that PUTs images into the self-hosted `apps/oss`
- `agent/`: Kagami's agent business layer — the phone-OS runtime (Portal / App / NotificationCenter), capabilities, context compaction
- `ops/`: query endpoints for App Log, LLM Chat Call, main Agent context, NapCat history, etc.
- `app/`: top-level runtime assembly — module wiring, Fastify route registration, health checks, Agent / gateway lifecycle

`apps/agent/src/agent` is organized into `runtime/`, `capabilities/`, and `apps/`:

- `runtime/`: Kagami-specific runtime such as `RootAgentRuntime`, session (the App launcher), `NotificationCenter`, event queue, context rendering, App-state persistence
- `capabilities/`: implementations grouped by capability, currently including `messaging`, `context-summary`, `ledger`, `ithome`, `vision`, `web-search`, `browser`, `terminal`, `todo`
- `apps/`: the phone-OS Apps (places reachable via `enter` from the Portal), currently `qq`, `ithome`, `hn`, `calc`, `clock`, `browser`, `terminal`, `todo`

Kagami is modeled as a phone OS: every life input (QQ message, RSS, timer) is a peer event. The passive `NotificationCenter` is the single bridge for background / unfocused signals to the Agent (the "banner") — sources fold signals into notifications, which it batches and enqueues to wake the Agent; the conversation he is currently looking at behaves like the phone screen instead: new messages flow straight into context via `foreground_input`, no banner needed. Each capability/App is "one more way for the Agent to live": `ithome` lets him read the news, `web-search` lets him look things up, `vision` lets him see images, `hn` gives him a read-only Hacker News, `browser` gives him a body to browse the real web, `todo` gives him a neutral to-do book. Future capabilities should be designed as "adding a new way of living for the Agent", not as "adding another feature toggle to a chat bot".

Main endpoint groups:

- `/health`
- `/auth/:provider/status`
- `/auth/:provider/login-url`
- `/auth/:provider/logout`
- `/auth/:provider/refresh`
- `/auth/:provider/usage-limits`
- `/auth/:provider/usage-trend`
- `/llm/providers`
- `/llm/playground-tools`
- `/llm/chat`
- `/napcat/group/send`
- `/napcat/private/send`
- `/app-log/query`
- `/llm-chat-call/query`
- `/llm-chat-call/:id`
- `/napcat-event/query`
- `/napcat-group-message/query`
- `/main-agent-context/recent`
- `/main-agent-context/compact`
- `/metric-chart/*`
- `/scheduler/*`

### Frontend

The frontend is a React admin console used to observe the Agent's "life state" (what he has recently been thinking, doing, and seeing). Main pages:

- `/main-agent-context`: main Agent context (default entry)
- `/auth/:provider`
- `/control-panel`
- `/scheduler-tasks`
- `/llm-playground`
- `/llm-history`
- `/app-log-history`
- `/napcat-event-history`
- `/napcat-group-message-history`
- `/story-history`
- `/metric-charts`

Notes:

- Page components are organized by business domain under `apps/web/src/pages/*`.
- The current Vite config only provides the `@ -> apps/web/src` alias and has no built-in dev proxy.

### Shared Package

- `packages/shared` holds schemas, DTOs, and utility functions shared between frontend and backend.
- `packages/shared` no longer provides a root barrel entry; prefer explicit subpath imports.
- `@kagami/shared` does not export `z`; import Zod directly from `zod` when defining schemas.

### Agent Runtime Package

- `packages/agent-runtime` only carries the generic Agent / App framework kernel, not Kagami-specific semantics.
- Core exports currently include `TaskAgent`, `Operation`, the `App` / `AppManager` / `AppStateStore` framework, `ToolCatalog`, `ToolSet`, `ToolExecutor`, and related abstractions. (The concrete `InvokeTool` itself lives in `apps/agent`, not here.)
- NapCat event models, the Kagami system prompt, and concrete capability implementations remain under `apps/agent/src/agent`.

## Deployment

- The PM2 config file is [ecosystem.config.cjs](./ecosystem.config.cjs). It manages seven processes.
- The backend service `kagami-agent` runs `apps/agent/dist/index.js` and listens on `20003` by default.
- The admin-console backend `kagami-console` runs `apps/console/dist/index.js` and listens on `20006` by default.
- The gateway service `kagami-gateway` runs `apps/gateway/dist/index.js` and listens on `20004` by default.
- The LLM service `kagami-llm` runs `apps/llm/dist/index.js` and listens on `20009` by default (localhost only); it owns the providers + OAuth callback server + refresh timers, and the gateway routes `/auth/*` to it.
- The metric service `kagami-metric` runs `apps/metric/dist/index.js` and listens on `20010` by default (localhost only); it owns metric ingestion (`POST /metric/record`, the agent reports fire-and-forget over HTTP) plus the metric-chart query endpoints, which the gateway routes to it.
- The object storage service `kagami-oss` runs `apps/oss` and listens on `20005` by default (localhost only).
- The browser service `kagami-browser` runs `apps/browser/dist/index.js` and listens on `20007` by default (localhost only); it owns CloakBrowser so an agent restart does not kill the browser. `app:deploy agent` does not touch it (see issue #173).
- The frontend static server serves `apps/web/dist` and proxies `/api/*` to `http://localhost:20003/*`.
- Running `pnpm app:deploy` performs the build, Prisma migrations, PM2 reload/startOrReload, and `pm2 save`.

Prerequisites:

- The database is an in-process SQLite file (default `data/sqlite/kagami.db`) — the host no longer needs to run an external database. It only needs to be able to compile native modules (`better-sqlite3`, `hnswlib-node`).
- The host must provide Napcat.
- `config.yaml` typically accesses Napcat via `localhost`.
