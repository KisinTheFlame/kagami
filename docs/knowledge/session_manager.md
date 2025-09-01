# SessionManager 会话管理器

## 定义

SessionManager 负责管理多个群组会话，协调连接管理器和消息处理器，实现消息分发和生命周期管理。位于 `src/session_manager.ts`。

## 核心功能

### 会话管理
- **会话创建**：为每个配置的群组创建独立的 [[session]]
- **消息分发**：根据 `group_id` 将消息路由到对应会话
- **策略选择**：根据配置创建对应的消息处理器
- **生命周期管理**：统一管理所有会话的初始化和关闭

### 消息处理器工厂
```typescript
async initializeSessions(): Promise<void> {
    for (const groupId of this.connectionManager.getGroupIds()) {
        const session = new Session(groupId, this.connectionManager);
        const maxHistory = this.agentConfig?.history_turns ?? 40;
        
        // 根据配置选择消息处理策略
        let handler;
        if (this.behaviorConfig.message_handler_type === "active") {
            handler = new ActiveMessageHandler(/*参数*/);
            this.activeHandlers.set(groupId, handler);
        } else {
            handler = new PassiveMessageHandler(/*参数*/);
        }
        
        session.setMessageHandler(handler);
        this.sessions.set(groupId, session);
    }
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
    private sessions: Map<number, Session>;           // 群组会话映射
    private activeHandlers = new Map<number, ActiveMessageHandler>(); // 主动处理器映射
    private connectionManager: ConnectionManager;     // 连接管理器
    private llmClient: LlmClient;                    // LLM 客户端
}
```

### 依赖注入
- **ConnectionManager**：统一的连接管理
- **LlmClient**：LLM 功能支持
- **配置对象**：各种配置参数的传递

## 消息处理策略

### 策略模式实现
```typescript
if (this.behaviorConfig.message_handler_type === "active") {
    handler = new ActiveMessageHandler(
        this.llmClient,
        this.botQQ,
        groupId,
        session,
        this.behaviorConfig,
        this.masterConfig,
        maxHistory,
    );
} else {
    handler = new PassiveMessageHandler(
        this.llmClient,
        this.botQQ,
        groupId,
        session,
        this.masterConfig,
        maxHistory,
    );
}
```

### 策略差异
- **主动策略**：[[active_message_handler]] + [[energy_manager]]
- **被动策略**：[[passive_message_handler]]，仅 @ 触发

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

### 初始化流程
1. **连接建立**：调用 `connectionManager.connect()`
2. **会话创建**：为每个群组创建 Session 实例
3. **处理器创建**：根据策略创建对应的 MessageHandler
4. **消息分发设置**：注册消息分发回调函数

### 关闭流程
```typescript
shutdownAllSessions(): void {
    // 清理 ActiveMessageHandler 中的定时器
    for (const handler of this.activeHandlers.values()) {
        handler.destroy();
    }
    this.activeHandlers.clear();
    
    // 断开连接管理器
    this.connectionManager.disconnect();
    
    // 清空会话映射
    this.sessions.clear();
}
```

## 状态监控

### 连接状态查询
```typescript
getConnectionStatus(): Map<number, boolean> {
    const status = new Map<number, boolean>();
    const isConnected = this.connectionManager.isConnectionActive();
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

### 直接依赖
- [[connection_manager]] - 连接管理
- [[session]] - 单个群组会话
- [[llm_client]] - LLM 功能
- [[active_message_handler]] / [[passive_message_handler]] - 消息处理策略

### 配置依赖
- [[config_system]] - 所有配置参数的来源

### 被依赖关系
- [[kagami_bot]] - 主应用使用 SessionManager 管理所有会话

## 相关文件
- `src/session_manager.ts` - 主要实现
- `src/session.ts` - Session 类定义
- `src/connection_manager.ts` - ConnectionManager 类