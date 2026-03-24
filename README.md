# Kagami

Kagami 是一个基于 `pnpm` Monorepo 的 QQ 群聊机器人，后端运行配置统一来自仓库根目录的 `config.yaml`。

## 配置方式

- 在仓库根目录提供真实的 `config.yaml`，字段结构参考 `config.yaml.example`。
- 服务启动时会一次性读取并校验 `config.yaml`；修改配置后需要重启服务生效。

配置结构：

```yaml
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami?schema=public
  port: 20003
  napcat:
    wsUrl: ws://localhost:6099
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupIds:
      - "123456"
  llm:
    timeoutMs: 45000
    codexAuth:
      enabled: true
      publicBaseUrl: http://localhost:20004
      oauthRedirectPath: /auth/callback
      oauthStateTtlMs: 600000
      refreshLeewayMs: 60000
      binaryPath: codex
    claudeCodeAuth:
      enabled: true
      publicBaseUrl: http://localhost:20004
      oauthRedirectPath: /callback
      oauthStateTtlMs: 600000
      refreshLeewayMs: 60000
    providers:
      deepseek:
        apiKey: ""
        baseUrl: https://api.deepseek.com
        models:
          - deepseek-chat
      openai:
        apiKey: ""
        baseUrl: https://api.openai.com/v1
        models:
          - gpt-4o-mini
      openaiCodex:
        baseUrl: https://chatgpt.com/backend-api/codex/responses
        models:
          - gpt-5.3-codex
      claudeCode:
        baseUrl: https://api.anthropic.com
        models:
          - claude-sonnet-4-20250514
    usages:
      agent:
        attempts:
          - provider: deepseek
            model: deepseek-chat
      contextSummarizer:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      vision:
        attempts:
          - provider: openai
            model: gpt-4o-mini
  rag:
    embedding:
      provider: google
      apiKey: your-gemini-api-key
      baseUrl: https://generativelanguage.googleapis.com
      model: gemini-embedding-001
      outputDimensionality: 768
    retrieval:
      topK: 3
  tavily:
    apiKey: ""
  bot:
    qq: "10001"
```

## 配置约定

- `server.databaseUrl`、Napcat 连接信息、`server.bot.qq`、`server.rag.embedding.apiKey` 与 `server.tavily.apiKey` 为必填项。
- `server.port` 默认值为 `20003`。
- `server.llm.timeoutMs` 默认值为 `45000`。
- `server.napcat.listenGroupIds` 为字符串数组，至少包含一个群号。
- `server.llm.providers.deepseek.baseUrl` 默认到 `https://api.deepseek.com`。
- `server.llm.providers.openai.baseUrl` 为空字符串时，会回退到 `https://api.openai.com/v1`。
- `server.llm.codexAuth` 负责 Kagami 内置的 Codex 登录和自动刷新；OpenAI OAuth 会先回调到本机 `localhost:1455`，再由本地回调服务跳回 `publicBaseUrl` 对应的管理页。`binaryPath` 用于指定服务端拉起 `codex app-server` 时使用的 CLI 路径，默认值为 `codex`。
- `server.llm.claudeCodeAuth` 负责 Claude Code OAuth 登录和自动刷新。
- `server.llm.usages` 需要为 `agent`、`contextSummarizer`、`vision` 提供模型尝试链路；`replyThought`、`replyReview`、`replyWriter` 未配置时会回退到 `agent`。
- `server.rag.embedding` 用于向量化，当前固定使用 Google Gemini Embedding。
- `server.llm.providers.*.apiKey` 与 `server.tavily.apiKey` 为空字符串时视为未配置。

## PM2 部署

- 确保宿主机已运行 PostgreSQL（`localhost:5432`）和 Napcat（示例：`localhost:6099`）。
- 执行 `pnpm app:deploy` 会完成构建、Prisma 迁移，并通过 PM2 启动或重载 `kagami-server` 与 `kagami-web`。
- PM2 入口为根目录 [ecosystem.config.cjs](/Users/kisin/Workspace/kagami/ecosystem.config.cjs)。
- 前端静态服务默认监听 `20004`，并将 `/api/*` 代理到 `http://localhost:20003/*`。
