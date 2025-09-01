# ConnectionManager 连接管理器

## 定义

ConnectionManager 负责管理与 napcat 的 WebSocket 连接，提供统一的消息发送接口和用户信息查询功能。位于 `src/connection_manager.ts`。

## 核心功能

### 连接管理
- **单一连接**：维护全局唯一的 napcat WebSocket 连接
- **连接状态跟踪**：通过 `isConnected` 标志管理连接状态
- **事件监听**：监听 `message.group` 事件接收群组消息
- **优雅断开**：提供安全的连接断开功能

### 消息分发
```typescript
export type MessageDispatcher = (context: unknown) => void;

setMessageDispatcher(dispatcher: MessageDispatcher): void {
    this.messageDispatcher = dispatcher;
}

private setupEventHandlers(): void {
    this.napcat.on("message.group", context => {
        if (this.messageDispatcher) {
            this.messageDispatcher(context);
        }
    });
}
```

### 消息发送
```typescript
async sendGroupMessage(groupId: number, content: SendMessageSegment[]): Promise<void> {
    await this.napcat.send_group_msg({
        group_id: groupId,
        message: content,
    });
}
```

### 用户信息查询
```typescript
async getUserNickname(groupId: number, userId: number): Promise<string | undefined> {
    const memberInfo = await this.napcat.get_group_member_info({
        group_id: groupId,
        user_id: userId,
    });
    return memberInfo.nickname || memberInfo.card || undefined;
}

async getBotQQ(): Promise<number | undefined> {
    const loginInfo = await this.napcat.get_login_info();
    return loginInfo.user_id;
}
```

## 设计特点

### 统一接口
- **抽象底层复杂性**：封装 node-napcat-ts 的具体实现
- **类型安全**：提供 TypeScript 类型定义
- **错误处理**：统一的错误捕获和日志记录

### 分发机制
- **回调模式**：通过消息分发器实现事件驱动
- **解耦设计**：连接管理与业务逻辑分离
- **动态注册**：支持运行时设置消息分发器

### 资源管理
- **连接复用**：所有群组共享同一个 WebSocket 连接
- **状态查询**：提供连接状态和群组信息的查询接口
- **安全关闭**：确保连接资源正确释放

## 依赖关系

### 外部依赖
- **node-napcat-ts**：WebSocket 连接和 QQ API 封装
- [[config_system]]：napcat 连接配置

### 被依赖关系
- [[session_manager]]：使用连接管理器进行消息分发
- [[session]]：通过连接管理器发送消息

## 配置要求

### NapcatConfig 配置项
```typescript
export interface NapcatConfig {
    base_url: string;        // napcat WebSocket 地址
    access_token: string;    // 访问令牌
    reconnection: {          // 重连配置
        enable: boolean;
        attempts: number;
        delay: number;
    };
    groups: number[];        // 目标群组列表
    bot_qq: number;         // 机器人 QQ 号
}
```

## 错误处理

### 连接错误
- **连接失败**：抛出连接异常，由上层处理
- **发送失败**：记录错误日志并重新抛出异常
- **查询失败**：返回 undefined 而不是抛出异常

### 状态检查
- **发送前验证**：检查连接状态，未连接时抛出异常
- **查询前验证**：未连接时直接返回 undefined
- **防护性编程**：所有网络操作都包含 try-catch

## 生命周期

### 初始化
1. 创建 NCWebsocket 实例（传入配置）
2. 设置初始连接状态为 false
3. 等待 `connect()` 调用

### 连接阶段
1. 调用 `napcat.connect()`
2. 设置事件处理器
3. 更新连接状态为 true

### 运行阶段
1. 接收和分发群组消息
2. 处理消息发送请求
3. 响应用户信息查询

### 关闭阶段
1. 调用 `napcat.disconnect()`
2. 更新连接状态为 false
3. 清理事件监听器

## 相关文件
- `src/connection_manager.ts` - 主要实现
- `src/config.ts` - 配置接口定义