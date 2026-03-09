# Kagami

Kagami 是一个基于 `pnpm` Monorepo 的 QQ 群聊机器人，后端运行配置统一来自仓库根目录的 `config.yaml`。

## 配置方式

- 在仓库根目录提供真实的 `config.yaml`，字段结构参考 `config.yaml.example`。
- 服务启动时会一次性读取并校验 `config.yaml`；修改配置后需要重启服务生效。

配置结构：

```yaml
server:
  databaseUrl: postgresql://user:password@postgres_db:5432/kagami?schema=public
  port: 3000
  napcat:
    wsUrl: ws://napcat:6099
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupId: "123456"
  llm:
    activeProvider: deepseek
    timeoutMs: 45000
    providers:
      deepseek:
        apiKey: ""
        baseUrl: https://api.deepseek.com
        chatModel: deepseek-chat
      openai:
        apiKey: ""
        baseUrl: https://api.openai.com/v1
        chatModel: gpt-4o-mini
  tavily:
    apiKey: ""
  bot:
    qq: "10001"
```

## 配置约定

- `server.databaseUrl`、Napcat 连接信息和 `server.bot.qq` 为必填项。
- `server.port` 默认值为 `3000`。
- `server.llm.activeProvider` 默认值为 `deepseek`，`server.llm.timeoutMs` 默认值为 `45000`。
- `server.llm.providers.deepseek.baseUrl` 和 `chatModel` 分别默认到 `https://api.deepseek.com`、`deepseek-chat`。
- `server.llm.providers.openai.baseUrl` 和 `chatModel` 为空字符串时，会分别回退到 `https://api.openai.com/v1`、`gpt-4o-mini`。
- `server.llm.providers.*.apiKey` 与 `server.tavily.apiKey` 为空字符串时视为未配置。

## Docker 部署

- `docker compose` 会将仓库根目录下的 `config.yaml` 挂载到服务容器内的 `/app/config.yaml`。
- 当前 `docker-compose.yml` 默认把后端映射到宿主机 `3000` 端口，因此 `server.port` 应保持为 `3000`。
