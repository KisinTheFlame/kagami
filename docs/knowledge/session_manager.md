# SessionManager 会话管理器

## 定义

SessionManager 负责管理多个群组会话，协调连接管理器和消息处理器，实现消息分发和生命周期管理。位于 `src/session_manager.ts`。

## 核心功能

### 会话管理
- **会话创建**：为每个配置的群组创建独立的 [[session]]
- **消息分发**：根据 `group_id` 将消息路由到对应会话
- **消息处理器创建**：为每个群组创建统一的MessageHandler
- **生命周期管理**：统一管理所有会话的初始化和关闭

### 统一消息处理器创建
```typescript
async initializeSessions(): Promise<void> {
    for (const groupId of this.connectionManager.getGroupIds()) {
        const session = new Session(groupId, this.connectionManager);
        const maxHistory = this.agentConfig?.history_turns ?? 40;

        // 创建统一的消息处理器
        const handler = new MessageHandler(
            this.llmClient,
            this.botQQ,
            groupId,
            session,
            this.behaviorConfig,
            this.masterConfig,
            maxHistory,
        );
        this.messageHandlers.set(groupId, handler);

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
    private messageHandlers = new Map<number, MessageHandler>(); // 消息处理器映射
    private connectionManager: ConnectionManager;     // 连接管理器
    private llmClient: LlmClient;                    // LLM 客户端
}
```

### 依赖注入
- **ConnectionManager**：统一的连接管理
- **LlmClient**：LLM 功能支持
- **配置对象**：各种配置参数的传递

## 统一消息处理

### 简化架构
```typescript
// 统一使用MessageHandler，包含所有功能
const handler = new MessageHandler(
    this.llmClient,
    this.botQQ,
    groupId,
    session,
    this.behaviorConfig, // 包含体力系统配置
    this.masterConfig,
    maxHistory,
);
```

### 架构简化收益
- **统一处理器**：[[message_handler]] 整合了所有消息处理功能
- **移除策略选择**：不再需要 `message_handler_type` 配置
- **完整功能**：包含 LLM集成 + 体力系统 + 并发控制 + 消息历史管理

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
    // 清理 MessageHandler 中的定时器（体力恢复等）
    for (const handler of this.messageHandlers.values()) {
        handler.destroy();
    }
    this.messageHandlers.clear();

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
- [[message_handler]] - 统一的消息处理器

### 配置依赖
- [[config_system]] - 所有配置参数的来源

### 被依赖关系
- [[kagami_bot]] - 主应用使用 SessionManager 管理所有会话

## 相关文件
- `src/session_manager.ts` - 主要实现
- `src/session.ts` - Session 类定义
- `src/connection_manager.ts` - ConnectionManager 类