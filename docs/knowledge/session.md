# Session 群组会话

## 定义

Session 类封装单个 QQ 群组的消息处理逻辑，负责消息解析、格式化和转发。位于 `src/session.ts:22-96`。

## 核心功能

### 消息接收和解析
```typescript
async handleMessage(context: unknown): Promise<void> {
    const ctx = context as {
        message_id: number;
        group_id: number;
        user_id: number;
        message: SendMessageSegment[];
    };

    // 获取用户昵称
    const userNickname = await this.connectionManager.getUserNickname(this.groupId, ctx.user_id);

    // 检查回复消息关系
    const replySegment = ctx.message.find(segment => segment.type === "reply");
    const replyToMessageId = replySegment?.data.id;

    // 构建标准化消息对象
    const message: Message = {
        id: String(ctx.message_id),
        groupId: ctx.group_id,
        userId: ctx.user_id,
        userNickname,
        content: ctx.message,
        timestamp: getShanghaiTimestamp(), // Asia/Shanghai时区
        metadata: replyToMessageId ? { replyToMessageId } : undefined,
    };

    // 委托给消息处理器
    if (this.messageHandler) {
        await this.messageHandler.handleMessage(message);
    }
}
```

### 消息格式化
```typescript
private formatMessageForDisplay(messageArray: SendMessageSegment[]): string {
    const parts: string[] = [];

    for (const msg of messageArray) {
        if (msg.type === "text" && "text" in msg.data && msg.data.text) {
            parts.push(msg.data.text);
        } else if (msg.type === "at" && "qq" in msg.data && msg.data.qq) {
            parts.push(`@${msg.data.qq}`);
        } else if (msg.type === "reply" && "id" in msg.data) {
            parts.push(`[回复:${msg.data.id}]`);
        }
    }

    return parts.join("");
}
```

## 设计模式

### 委托模式
- **连接委托**：通过 [[connection_manager]] 发送消息
- **处理委托**：通过 [[base_message_handler]] 处理业务逻辑
- **职责单一**：专注于群组级别的消息转换和路由

### 适配器模式
```typescript
// napcat 原始事件 → 标准化 Message 对象
const message: Message = {
    id: String(ctx.message_id),
    groupId: ctx.group_id,
    userId: ctx.user_id,
    userNickname,
    content: ctx.message,      // 保持原始的 SendMessageSegment[] 格式
    timestamp: getShanghaiTimestamp(), // Asia/Shanghai时区
    metadata: replyToMessageId ? { replyToMessageId } : undefined,
};
```

## 消息类型支持

### 基本消息类型
- **文本消息**：`{"type": "text", "data": {"text": "内容"}}`
- **@ 消息**：`{"type": "at", "data": {"qq": "QQ号"}}`
- **回复消息**：`{"type": "reply", "data": {"id": "消息ID"}}`

### 回复关系处理
- **解析回复**：自动检测消息中的 reply 段
- **关系记录**：存储到 `metadata.replyToMessageId`
- **日志显示**：在控制台显示回复关系信息
- **上下文传递**：将回复信息传递给 LLM

## 依赖关系

### 构造时依赖
- **groupId**：群组标识符
- [[connection_manager]]：连接和发送消息

### 运行时依赖
- [[base_message_handler]]：具体的消息处理逻辑（通过 `setMessageHandler` 注入）

### 数据模型
- [[message_data_model]]：标准化的消息数据结构

## 接口设计

### MessageHandler 接口
```typescript
export interface MessageHandler {
    handleMessage(message: Message): Promise<void>;
}
```

### 公共方法
```typescript
class Session {
    async handleMessage(context: unknown): Promise<void>        // 处理原始 napcat 消息
    async sendMessage(content: SendMessageSegment[]): Promise<void> // 发送消息到群组
    setMessageHandler(handler: MessageHandler): void           // 设置消息处理器
}
```

## 错误处理

### 消息解析错误
- **类型安全**：使用 TypeScript 类型断言
- **默认值处理**：用户昵称获取失败时使用"未知用户"
- **异常传播**：将处理错误传播到上层

### 发送错误
- **委托处理**：发送错误由 ConnectionManager 处理
- **错误日志**：记录群组级别的错误信息

## 扩展性

### 消息类型扩展
- 支持添加新的 SendMessageSegment 类型
- 格式化显示逻辑可扩展支持新类型
- Message 接口的 metadata 字段支持扩展信息

### 处理器扩展
- 通过 MessageHandler 接口支持新的处理策略
- 可动态切换不同的消息处理器
- 支持链式处理器和中间件模式

## 相关文件
- `src/session.ts` - 主要实现
- `src/connection_manager.ts` - 连接管理依赖
- `src/base_message_handler.ts` - 消息处理器接口