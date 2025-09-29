# KagamiBot 主应用

## 定义

KagamiBot 是项目的主应用类，负责整个机器人的初始化、启动、运行和关闭过程。位于 `src/main.ts`。

## 核心功能

### 分层初始化流程（bootstrap 函数）
```typescript
async function bootstrap() {
    console.log("正在初始化 Kagami 机器人...");

    // 1. 配置层
    const configManager = newConfigManager();

    // 2. 基础设施层 - 数据访问
    const database = newDatabase();

    // 3. 基础设施层 - 外部服务
    const napcatFacade = await newNapcatFacade(configManager);
    const promptTemplateManager = newPromptTemplateManager();

    // 4. LLM 层
    const llmClientManager = newLlmClientManager(configManager, database);

    // 5. 编排层
    const sessionManager = newSessionManager(
        configManager,
        napcatFacade,
        llmClientManager,
        promptTemplateManager,
    );

    // 6. 应用层
    const bot = newKagamiBot(sessionManager);

    return bot;
}
```

### 启动流程
```typescript
start(): void {
    console.log("Kagami 机器人启动成功");
    console.log(`活跃会话数量: ${String(this.sessionManager.getSessionCount())}`);

    this.setupGracefulShutdown();
}
```

### 关闭流程
```typescript
stop(): void {
    console.log("正在停止 Kagami 机器人...");

    try {
        this.sessionManager.shutdownAllSessions();
        console.log("Kagami 机器人停止成功");
    } catch (error) {
        console.error("关闭过程中发生错误:", error);
    }
}
```

## 依赖关系

### 直接依赖（通过依赖注入）
- [[session_manager]] - 会话和连接管理（注入）

### 构造函数
```typescript
class KagamiBot {
    private sessionManager: SessionManager;

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }
}
```

### 工厂函数
```typescript
export const newKagamiBot = (sessionManager: SessionManager) => {
    return new KagamiBot(sessionManager);
};
```

## 错误处理

### 初始化阶段
- 配置文件缺失或格式错误时立即退出
- 必要配置项缺失时抛出详细错误信息
- 所有错误都会输出中文错误消息

### 运行时阶段
- 会话初始化失败不会终止整个应用
- 单个群组连接失败不影响其他群组
- 优雅关闭时捕获并记录清理过程中的错误

## 生命周期管理

### 启动顺序（分层初始化）
1. **配置层**：ConfigManager 初始化
2. **基础设施层 - 数据访问**：Database 初始化
3. **基础设施层 - 外部服务**：NapcatFacade 连接、PromptTemplateManager 加载
4. **LLM 层**：LlmClientManager 创建（依赖 ConfigManager 和 Database）
5. **编排层**：SessionManager 创建并自动初始化所有会话
6. **应用层**：KagamiBot 创建并启动
7. **信号处理器注册**：setupGracefulShutdown()

### 关闭顺序
1. 接收关闭信号（SIGINT/SIGTERM）
2. 关闭所有群组会话
3. 断开 NapCat 连接
4. 进程退出

## 依赖注入架构

### 架构特点
- **移除全局配置**：不再有全局 config 对象
- **分层初始化**：按照依赖顺序逐层构建组件
- **工厂函数模式**：所有组件通过工厂函数创建
- **依赖注入**：通过构造函数传递依赖关系

### Bootstrap 函数的六层架构
1. **配置层**：ConfigManager（配置读取和验证）
2. **基础设施层**：Database、NapcatFacade、PromptTemplateManager
3. **LLM 层**：LlmClientManager（依赖配置和数据库）
4. **编排层**：SessionManager（协调所有依赖）
5. **应用层**：KagamiBot（最上层封装）
6. **运行层**：main() 函数启动应用

## 使用示例

### 基本启动
```typescript
async function main(): Promise<void> {
    const bot = await bootstrap();
    bot.start();

    console.log("机器人已运行");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error: unknown) => {
        console.error("致命错误:", error);
        process.exit(1);
    });
}
```

### 优雅关闭
```typescript
private setupGracefulShutdown(): void {
    const shutdown = (signal: string) => {
        console.log(`接收到 ${signal} 信号，正在优雅关闭...`);
        this.stop();
        process.exit(0);
    };

    process.on("SIGINT", () => { shutdown("SIGINT"); });
    process.on("SIGTERM", () => { shutdown("SIGTERM"); });
}
```

## 相关文件
- `src/main.ts` - 主要实现
- `env.yaml.example` - 配置模板