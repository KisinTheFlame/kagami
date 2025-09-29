# SessionManager 会话管理器

## 定义

SessionManager 负责管理多个群组会话，协调连接管理器和消息处理器，实现消息分发和生命周期管理。位于 `src/session_manager.ts`。

## 核心功能

### 会话管理
- **会话创建**：为每个配置的群组创建独立的 [[session]]
- **消息分发**：根据 `group_id` 将消息路由到对应会话
- **消息处理器创建**：为每个群组创建统一的MessageHandler
- **生命周期管理**：统一管理所有会话的初始化和关闭

### 会话初始化
```typescript
initializeSessions(): void {
    console.log("正在为群组初始化会话:", this.napcatFacade.getGroupIds());

    // 为每个群组创建 Session
    for (const groupId of this.napcatFacade.getGroupIds()) {
        try {
            const session = newSession(groupId, this.napcatFacade);
            const contextManager = newContextManager(this.configManager, this.promptTemplateManager);
            const handler = newMessageHandler(session, contextManager, this.llmClientManager);

            session.setMessageHandler(handler);
            this.sessions.set(groupId, session);

            console.log(`群 ${String(groupId)} 会话和处理器初始化成功`);
        } catch (error) {
            console.error(`群 ${String(groupId)} 初始化失败:`, error);
        }
    }

    console.log(`会话管理器初始化完成，共 ${String(this.sessions.size)} 个活跃会话`);
}
```

### 消息分发机制
```typescript
private handleIncomingMessage(context: unknown): void {
    const ctx = context as { group_id: number; [key: string]: unknown };
    const groupId = ctx.group_id;
    const session = this.sessions.get(groupId);
    
    if (session) {
        void session.handleMessage(context);
    } else {
        console.warn(`收到群 ${String(groupId)} 的消息，但未找到对应的会话`);
    }
}
```

## 架构设计

### 组合模式
```typescript
export class SessionManager {
    private sessions: Map<number, Session>;
    private napcatFacade: NapcatFacade;
    private configManager: ConfigManager;
    private llmClientManager: LlmClientManager;
    private promptTemplateManager: PromptTemplateManager;

    constructor(
        configManager: ConfigManager,
        napcatFacade: NapcatFacade,
        llmClientManager: LlmClientManager,
        promptTemplateManager: PromptTemplateManager,
    ) {
        this.sessions = new Map();
        this.configManager = configManager;
        this.napcatFacade = napcatFacade;
        this.llmClientManager = llmClientManager;
        this.promptTemplateManager = promptTemplateManager;
        this.napcatFacade.setMessageDispatcher(this.handleIncomingMessage.bind(this));
    }
}
```

### 工厂函数
```typescript
export const newSessionManager = (
    configManager: ConfigManager,
    napcatFacade: NapcatFacade,
    llmClientManager: LlmClientManager,
    promptTemplateManager: PromptTemplateManager,
) => {
    const instance = new SessionManager(configManager, napcatFacade, llmClientManager, promptTemplateManager);
    instance.initializeSessions();
    return instance;
};
```

工厂函数会自动调用 `initializeSessions()` 完成初始化。

### 依赖注入
- **ConfigManager**：配置管理器
- **NapcatFacade**：NapCat 连接门面（替代 ConnectionManager）
- **LlmClientManager**：LLM 客户端管理器
- **PromptTemplateManager**：提示词模板管理器

## 依赖注入重构

### 重构后的架构特点
- **移除全局单例**：所有依赖通过构造函数注入
- **同步初始化**：`initializeSessions()` 从异步改为同步
- **工厂函数模式**：使用工厂函数创建所有组件
- **配置集中管理**：通过 ConfigManager 统一获取配置

### 初始化流程
1. **构造阶段**：接收所有依赖（ConfigManager、NapcatFacade、LlmClientManager、PromptTemplateManager）
2. **设置消息分发器**：注册 `handleIncomingMessage` 回调
3. **会话初始化**：工厂函数自动调用 `initializeSessions()`
4. **组件创建**：为每个群组创建 Session、ContextManager 和 MessageHandler

## 消息发送功能

### 单群组发送
```typescript
async sendMessageToGroup(groupId: number, content: SendMessageSegment[]): Promise<boolean> {
    const session = this.sessions.get(groupId);
    if (!session) return false;
    
    await session.sendMessage(content);
    return true;
}
```

### 广播发送
```typescript
async broadcastMessage(content: SendMessageSegment[]): Promise<number> {
    const sendPromises = Array.from(this.sessions.entries()).map(async ([groupId, session]) => {
        try {
            await session.sendMessage(content);
            return true;
        } catch (error) {
            return false;
        }
    });
    
    const results = await Promise.allSettled(sendPromises);
    return results.filter(result => result.status === "fulfilled" && result.value).length;
}
```

## 生命周期管理

### 关闭流程
```typescript
shutdownAllSessions(): void {
    console.log("正在关闭所有会话...");

    try {
        this.napcatFacade.disconnect();
        console.log("连接管理器已关闭");
    } catch (error) {
        console.error("关闭连接管理器失败:", error);
    }

    this.sessions.clear();
    console.log("所有会话已关闭");
}
```

## 状态监控

### 连接状态查询
```typescript
getConnectionStatus(): Map<number, boolean> {
    const status = new Map<number, boolean>();
    const isConnected = this.napcatFacade.isConnectionActive();
    for (const [groupId] of this.sessions) {
        status.set(groupId, isConnected);
    }
    return status;
}
```

### 会话统计
- `getSessionCount()`: 活跃会话数量
- `getActiveGroupIds()`: 活跃群组 ID 列表
- `getAllSessions()`: 所有会话实例

## 依赖关系

### 直接依赖（通过依赖注入）
- [[config_manager]] - 配置管理器（注入）
- [[connection_manager]] - NapcatFacade 连接门面（注入）
- [[llm_client_manager]] - LLM 客户端管理器（注入）
- [[prompt_template_manager]] - 提示词模板管理器（注入）
- [[session]] - 单个群组会话（通过工厂函数创建）
- [[context_manager]] - 上下文管理器（通过工厂函数创建）
- [[message_handler]] - 消息处理器（通过工厂函数创建）

### 被依赖关系
- [[kagami_bot]] - 主应用使用 SessionManager 管理所有会话

## 相关文件
- `src/session_manager.ts` - 主要实现
- `src/session.ts` - Session 类定义
- `src/connection_manager.ts` - ConnectionManager 类