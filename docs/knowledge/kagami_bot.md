# KagamiBot 主应用

## 定义

KagamiBot 是项目的主应用类，负责整个机器人的初始化、启动、运行和关闭过程。位于 `src/main.ts:5-87`。

## 核心功能

### 初始化流程
1. **配置加载**：调用 `loadConfig()` 读取 YAML 配置文件
2. **LLM 客户端创建**：基于配置创建 `LlmClient` 实例
3. **配置验证**：检查必要配置项的完整性
4. **状态输出**：显示机器人 QQ 号、群组列表、消息处理策略

### 启动流程
1. **会话管理器创建**：实例化 [[session_manager]]
2. **会话初始化**：调用 `initializeSessions()` 建立所有群组连接
3. **状态监控**：输出连接状态和活跃会话数量
4. **优雅关闭设置**：注册 SIGINT/SIGTERM 信号处理器

### 关闭流程
1. **会话关闭**：调用 `sessionManager.shutdownAllSessions()`
2. **资源清理**：清理定时器和连接资源
3. **进程退出**：安全退出应用进程

## 依赖关系

### 直接依赖
- [[config_system]] - 配置管理和类型定义
- [[llm_client]] - LLM API 客户端
- [[session_manager]] - 会话和连接管理

### 配置传递
```typescript
constructor() {
    this.config = loadConfig();                    // 从 ConfigSystem
    this.llmClient = new LlmClient(this.config.llm); // 传递给 LlmClient
}

async start() {
    this.sessionManager = new SessionManager(
        this.config.napcat,    // 传递给 SessionManager
        this.llmClient,        // 传递 LlmClient 实例
        this.config.napcat.bot_qq,
        this.config.behavior,
        this.config.master,
        this.config.agent,
    );
}
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

### 启动顺序
1. KagamiBot 实例化
2. 配置系统初始化
3. LLM 客户端初始化
4. 会话管理器创建
5. 所有群组会话初始化
6. 信号处理器注册

### 关闭顺序
1. 接收关闭信号
2. 关闭所有群组会话
3. 断开 napcat 连接
4. 清理定时器资源
5. 进程退出

## 配置集成

### 必需配置
- `llm`: LLM API 配置 → 传递给 [[llm_client]]
- `napcat`: napcat 连接配置 → 传递给 [[session_manager]]

### 可选配置
- `behavior`: 消息处理行为配置 → 传递给消息处理器
- `master`: 主人特权配置 → 传递给消息处理器
- `agent`: 对话历史配置 → 传递给消息处理器

## 使用示例

### 基本启动
```typescript
const bot = new KagamiBot();
await bot.start();
```

### 优雅关闭
```typescript
// 信号处理器自动注册
process.on('SIGINT', () => bot.stop());
```

## 相关文件
- `src/main.ts` - 主要实现
- `env.dev.yaml.example` - 开发环境配置模板
- `env.prod.yaml.example` - 生产环境配置模板