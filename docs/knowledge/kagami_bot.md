# KagamiBot 主应用

## 定义

KagamiBot 主应用负责整个机器人的初始化和启动过程。位于 `kagami-bot/src/main.ts`。

**注**：在最新的重构中，KagamiBot 类已被移除，改为直接在 `bootstrap()` 函数中初始化所有组件，简化了应用层架构。

## 核心功能

### 分层初始化流程（bootstrap 函数）
```typescript
async function bootstrap() {
    try {
        console.log("正在初始化 Kagami 机器人...");

        // 1. 配置层
        const configManager = newConfigManager();

        // 2. 基础设施层 - 数据访问
        const database = newDatabase();
        const llmCallLogRepository = newLlmCallLogRepository(database);

        // 3. 基础设施层 - 外部服务
        const napcatFacade = await newNapcatFacade(configManager);
        const promptTemplateManager = newPromptTemplateManager();

        // 4. LLM 层
        const llmClientManager = newLlmClientManager(configManager, llmCallLogRepository);

        // 5. 编排层
        newSessionManager(configManager, napcatFacade, llmClientManager, promptTemplateManager);

        console.log("Kagami 机器人已启动");

        // 6. HTTP Handler 层
        const httpConfig: HttpConfig = configManager.getHttpConfig();
        const llmLogsRouter = createLlmLogsRouter(llmCallLogRepository);

        // 7. HTTP 服务层
        await createHttpServer(llmLogsRouter, httpConfig);

        console.log(`HTTP 服务器已启动，监听端口 ${String(httpConfig.port)}`);
    } catch (error) {
        console.error("机器人初始化失败:", error);
        process.exit(1);
    }
}
```

### 主函数
```typescript
async function main(): Promise<void> {
    await bootstrap();
    console.log("bootstrap 完成");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error: unknown) => {
        console.error("致命错误:", error);
        process.exit(1);
    });
}
```

## 架构变更

### 移除 KagamiBot 类
在重构中移除了 KagamiBot 应用层类，原因：
- **简化架构**：应用层只包含 bootstrap 和 main 函数，无需额外的类封装
- **减少抽象**：SessionManager 自动处理会话初始化，无需应用层干预
- **直接初始化**：HTTP 服务和机器人功能并列初始化，无需分层封装

### Bootstrap 函数作为入口
Bootstrap 函数承担了原 KagamiBot 类的职责：
- 按照依赖顺序初始化所有组件
- 统一的错误处理和日志输出
- 启动 HTTP 服务

## 错误处理

### 初始化阶段
- 配置文件缺失或格式错误时立即退出
- 必要配置项缺失时抛出详细错误信息
- 所有错误都会输出中文错误消息

### 运行时阶段
- 会话初始化失败不会终止整个应用
- 单个群组连接失败不影响其他群组

## 生命周期管理

### 启动顺序（分层初始化）
1. **配置层**：ConfigManager 初始化
2. **基础设施层 - 数据访问**：Database、LlmCallLogRepository 初始化
3. **基础设施层 - 外部服务**：NapcatFacade 连接、PromptTemplateManager 加载
4. **LLM 层**：LlmClientManager 创建（依赖 ConfigManager 和 LlmCallLogRepository）
5. **编排层**：SessionManager 创建并自动初始化所有会话
6. **HTTP Handler 层**：创建 LlmLogsRouter（依赖 LlmCallLogRepository）
7. **HTTP 服务层**：启动 Express HTTP 服务器

## 依赖注入架构

### 架构特点
- **移除全局配置**：不再有全局 config 对象
- **分层初始化**：按照依赖顺序逐层构建组件
- **工厂函数模式**：所有组件通过工厂函数创建
- **依赖注入**：通过构造函数传递依赖关系
- **简化应用层**：移除 KagamiBot 类，直接在 bootstrap 中初始化

### Bootstrap 函数的七层架构
1. **配置层**：ConfigManager（配置读取和验证）
2. **基础设施层 - 数据访问**：Database、LlmCallLogRepository
3. **基础设施层 - 外部服务**：NapcatFacade、PromptTemplateManager
4. **LLM 层**：LlmClientManager（依赖配置和 Repository）
5. **编排层**：SessionManager（协调所有依赖）
6. **HTTP Handler 层**：LlmLogsRouter（依赖 Repository）
7. **HTTP 服务层**：HttpServer（依赖 Router 和配置）

## 相关节点

- [[config_manager]] - 配置管理
- [[database_layer]] - 数据库封装
- [[llm_call_log_repository]] - LLM 日志仓储
- [[connection_manager]] - NapCat 连接管理
- [[prompt_template_manager]] - 提示词模板管理
- [[llm_client_manager]] - LLM 客户端管理
- [[session_manager]] - 会话管理
- [[http_api_layer]] - HTTP API 服务

## 相关文件
- `kagami-bot/src/main.ts` - 主要实现
- `kagami-bot/env.yaml.example` - 配置模板