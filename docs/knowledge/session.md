# Session 群组会话

## 定义

Session 类封装单个 QQ 群组的消息处理逻辑，负责消息解析、格式化和转发。经过更新，现在支持自然语言格式转换和更好的封装性。位于 `src/session.ts`。

## 核心功能

### 消息接收和解析
```typescript
async handleMessage(context: NapcatGroupMessage): Promise<void> {
    try {
        const userNickname = await this.connectionManager.getUserNickname(this.groupId, context.user_id);

        // 转换为自然语言格式
        const chatContent = await this.convertToNaturalLanguage(context.message);

        // 在消息前添加发送者信息（单独一行）
        const senderInfo = `${userNickname ?? "未知用户"}(${String(context.user_id)}):\n`;
        const fullChatContent = senderInfo + chatContent;

        const groupMessage: GroupMessage = {
            id: String(context.message_id),
            userId: context.user_id,
            userNickname,
            chat: fullChatContent,
            timestamp: getShanghaiTimestamp(),
        };

        const message: Message = {
            type: "group_msg",
            value: groupMessage,
        };

        const displayContent = this.formatMessageForDisplay(context.message);
        console.log(`[群 ${String(this.groupId)}] ${userNickname ?? "未知用户"}(${String(context.user_id)}) 发送消息: ${displayContent}`);

        if (this.messageHandler) {
            await this.messageHandler.handleMessage(message);
        }
    } catch (error) {
        console.error(`群 ${String(this.groupId)} 消息处理失败:`, error);
    }
}
```

### 自然语言转换
```typescript
private async convertToNaturalLanguage(messageArray: Receive[keyof Receive][]): Promise<string> {
    const parts: string[] = [];

    for (const segment of messageArray) {
        if (segment.type === "text" && "text" in segment.data && segment.data.text) {
            // 普通文本消息保持原样
            parts.push(segment.data.text);
        } else if (segment.type === "at" && "qq" in segment.data && segment.data.qq) {
            // @消息格式化
            const atUserId = Number(segment.data.qq);
            const atUserNickname = await this.connectionManager.getUserNickname(this.groupId, atUserId);
            parts.push(`@${atUserNickname ?? "未知用户"}(${segment.data.qq}) `);
        } else if (segment.type === "reply" && "id" in segment.data) {
            // 回复消息格式化
            const replyMessageId = Number(segment.data.id);
            const replyDetail = await this.connectionManager.getMessageDetail(replyMessageId);
            if (replyDetail) {
                const replyNickname = replyDetail.sender.nickname;
                const replyUserId = replyDetail.sender.user_id;
                const replyContentPreview = this.formatMessageForDisplay(replyDetail.message).slice(0, 100);
                parts.push(`回复 ${replyNickname}(${replyUserId}): "${replyContentPreview}"\n`);
            } else {
                parts.push(`回复消息(ID:${segment.data.id})\n`);
            }
        }
    }

    return parts.join("");
}

private formatMessageForDisplay(messageArray: Receive[keyof Receive][]): string {
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
- **连接委托**：通过 [[connection_manager]] (NapcatFacade) 发送消息
- **处理委托**：通过 [[message_handler]] 处理业务逻辑
- **职责单一**：专注于群组级别的消息转换和路由

### 适配器模式
```typescript
// napcat 原始事件 → 标准化 Message 对象
const groupMessage: GroupMessage = {
    id: String(context.message_id),
    userId: context.user_id,
    userNickname,
    chat: fullChatContent,  // 转换为自然语言格式
    timestamp: getShanghaiTimestamp(),
};

const message: Message = {
    type: "group_msg",
    value: groupMessage,
};
```

## 消息类型支持

### 支持的消息类型
- **文本消息**：直接保持原始内容
- **@ 消息**：转换为 `@用户名(QQ号)` 格式
- **回复消息**：转换为 `回复 用户名(QQ号): "内容预览"` 格式

### 自然语言转换特性
- **用户友好性**：将QQ号转换为昵称显示
- **上下文保持**：回复消息包含原始内容预览
- **格式统一**：所有消息都转换为可读的自然语言
- **错误容忍**：无法获取用户信息时使用默认值

## 依赖关系

### 构造时依赖
- **groupId**：群组标识符
- [[connection_manager]]：NapcatFacade 实例，用于连接、发送消息和用户信息查询

### 运行时依赖
- [[message_handler]]：具体的消息处理逻辑（通过 `setMessageHandler` 注入）

### 数据模型
- [[message_data_model]]：标准化的消息数据结构

## 工厂函数

```typescript
export const newSession = (groupId: number, napcatFacade: NapcatFacade) => {
    return new Session(groupId, napcatFacade);
};
```

推荐使用工厂函数创建 Session 实例，保持代码风格统一。

## 接口设计

### MessageHandler 接口
```typescript
export interface MessageHandler {
    handleMessage(message: Message): Promise<void>;
}
```

### 数据类型
```typescript
// 群组消息类型
export interface GroupMessage {
    id: string;
    userId: number;
    userNickname?: string;
    chat: string;           // 自然语言格式的消息内容
    timestamp: string;
}

// 机器人消息类型
export interface BotMessage {
    thoughts: string[];     // LLM思考过程
    chat?: SendMessageSegment[]; // 回复内容
}

// 统一消息类型
export type Message =
    | { type: "bot_msg"; value: BotMessage; }
    | { type: "group_msg"; value: GroupMessage; };
```

### 公共方法
```typescript
class Session {
    constructor(groupId: number, napcatFacade: NapcatFacade)

    async handleMessage(context: NapcatGroupMessage): Promise<void>  // 处理原始 napcat 消息
    async sendMessage(content: SendMessageSegment[]): Promise<void>   // 发送消息到群组
    setMessageHandler(handler: MessageHandler): void                 // 设置消息处理器
    getGroupId(): number                                             // 获取群组ID
}
```

### 使用示例
```typescript
// 在 SessionManager 中创建 Session
const session = newSession(groupId, this.napcatFacade);
const handler = newMessageHandler(session, contextManager, this.llmClientManager);
session.setMessageHandler(handler);
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

## 新增功能

### 群组ID访问
```typescript
getGroupId(): number {
    return this.groupId;
}
```

为 [[message_handler]] 提供了对群组ID的安全访问，用于日志记录和错误处理。

## 相关文件
- `src/session.ts` - 主要实现
- `src/connection_manager.ts` - 连接管理依赖
- `src/message_handler.ts` - 消息处理器实现