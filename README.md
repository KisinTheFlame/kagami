# Kagami

Kagami 是一个基于 `pnpm` Monorepo 的 QQ 群聊机器人，当前后端业务配置由 Gaia 配置中心提供。

## 配置方式

- 本地 bootstrap 文件只保留 `gaia.config.yml`，用于声明 Gaia 服务地址。
- 业务配置统一从 Gaia 读取，不再依赖完整的 `.env` 文件。

示例 `gaia.config.yml`：

```yaml
baseUrl: http://localhost:20005
```

## Gaia 配置键

需要在 Gaia 中创建以下配置键：

- `kagami.database-url`
- `kagami.port`
- `kagami.llm.active-provider`
- `kagami.llm.timeout-ms`
- `kagami.deepseek.api-key`
- `kagami.deepseek.base-url`
- `kagami.deepseek.chat-model`
- `kagami.openai.api-key`
- `kagami.openai.base-url`
- `kagami.openai.chat-model`
- `kagami.tavily.api-key`
- `kagami.napcat.ws-url`
- `kagami.napcat.ws-reconnect-ms`
- `kagami.napcat.ws-request-timeout-ms`
- `kagami.napcat.listen-group-id`
- `kagami.bot.qq`

## 生命周期约定

- 启动时固定：
  - `kagami.database-url`
  - `kagami.port`
  - `kagami.napcat.ws-url`
  - `kagami.napcat.ws-reconnect-ms`
  - `kagami.napcat.ws-request-timeout-ms`
  - `kagami.napcat.listen-group-id`
- 运行时按需读取最新值：
  - `kagami.llm.*`
  - `kagami.deepseek.*`
  - `kagami.openai.*`
  - `kagami.tavily.api-key`
  - `kagami.bot.qq`

## Docker 部署

- `docker compose` 会将仓库根目录下的 `gaia.config.yml` 挂载到服务容器内。
- 当前 `docker-compose.yml` 默认把应用暴露在容器内 `3000` 端口，因此 `kagami.port` 需要与之保持一致。
