# Message 消息数据模型

## 定义

Message 接口定义了标准化的消息数据结构，用于在系统各组件间传递消息信息。位于 `src/session.ts:4-16`。

## 数据结构

### 核心字段
```typescript
export interface Message {
    id: string;                    // 消息唯一标识
    groupId: number;              // 群组 ID
    userId: number;               // 发送者 QQ 号
    userNickname?: string;        // 发送者昵称（可选）
    content: SendMessageSegment[]; // 结构化消息内容
    timestamp: string;            // 发送时间 (Asia/Shanghai时区，格式: YYYY-MM-DD HH:mm:ss)
    metadata?: {                  // 扩展元数据（可选）
        thoughts?: string[];       // LLM 思考过程
        hasReply?: boolean;       // 是否包含回复内容
        replyToMessageId?: string; // 回复的目标消息ID
    };
}
```

### SendMessageSegment 类型
基于 `node-napcat-ts` 库的标准消息段格式：

```typescript
// 文本消息
{"type": "text", "data": {"text": "消息内容"}}

// @ 消息
{"type": "at", "data": {"qq": "被@的QQ号"}}

// 回复消息
{"type": "reply", "data": {"id": "目标消息ID"}}
```

## 设计特点

### 结构化内容
- **类型安全**：基于 TypeScript 接口确保数据结构正确
- **多媒体支持**：content 数组可包含多种类型的消息段
- **扩展性强**：通过 metadata 字段支持未来功能扩展

### 完整上下文
- **用户信息**：包含 QQ 号和昵称
- **时间信息**：精确的消息发送时间
- **群组信息**：明确的群组归属
- **关系信息**：通过 metadata 记录消息间关系

### 双向兼容
- **用户消息**：从 napcat 原始事件转换而来
- **机器人消息**：包含 LLM 生成的思考过程和回复内容

## 使用场景

### 消息接收流程
```typescript
// 在 Session 中转换 napcat 原始事件
const message: Message = {
    id: String(ctx.message_id),
    groupId: ctx.group_id,
    userId: ctx.user_id,
    userNickname,                    // 异步获取的用户昵称
    content: ctx.message,            // 原始的 SendMessageSegment[]
    timestamp: getShanghaiTimestamp(), // 使用上海时区
    metadata: replyToMessageId ? { replyToMessageId } : undefined,
};
```

### 机器人消息创建
```typescript
// 在 BaseMessageHandler 中创建机器人消息
const botMessage: Message = {
    id: `bot_${String(Date.now())}`,
    groupId: this.groupId,
    userId: this.botQQ,
    content: reply ?? [],
    timestamp: getShanghaiTimestamp(), // 使用上海时区
    metadata: { 
        thoughts,      // LLM 的思考过程
        hasReply: !!reply // 是否包含实际回复
    },
};
```

### LLM 上下文传递
```typescript
// 传递给 LLM 的完整消息上下文
messages.push({
    role: "user",
    content: JSON.stringify(msg), // 完整的 Message 对象
});
```

## 扩展字段详解

### metadata.thoughts
- **用途**：存储 LLM 的思考过程
- **格式**：字符串数组，每个元素是一个思考步骤
- **来源**：从 LLM 响应的 thought 类型项中提取

### metadata.hasReply
- **用途**：标记机器人消息是否包含实际回复内容
- **格式**：boolean 值
- **用途**：区分"只思考不回复"和"思考后回复"的情况

### metadata.replyToMessageId
- **用途**：记录回复的目标消息 ID
- **格式**：目标消息的 ID 字符串
- **来源**：从消息 content 中的 reply 段提取

## 消息类型示例

### 用户文本消息
```json
{
  "id": "123456",
  "groupId": 789012,
  "userId": 345678,
  "userNickname": "张三",
  "content": [
    {"type": "text", "data": {"text": "今天天气真好"}}
  ],
  "timestamp": "2024-01-01 20:00:00"
}
```

### 用户 @ 消息
```json
{
  "id": "123457",
  "groupId": 789012,
  "userId": 345678,
  "userNickname": "张三",
  "content": [
    {"type": "at", "data": {"qq": "987654321"}},
    {"type": "text", "data": {"text": " 你好吗？"}}
  ],
  "timestamp": "2024-01-01 20:01:00"
}
```

### 用户回复消息
```json
{
  "id": "123458",
  "groupId": 789012,
  "userId": 345678,
  "userNickname": "张三",
  "content": [
    {"type": "reply", "data": {"id": "123456"}},
    {"type": "text", "data": {"text": "确实是呢"}}
  ],
  "timestamp": "2024-01-01 20:02:00",
  "metadata": {
    "replyToMessageId": "123456"
  }
}
```

### 机器人回复消息（只思考）
```json
{
  "id": "bot_1704110400000",
  "groupId": 789012,
  "userId": 987654321,
  "content": [],
  "timestamp": "2024-01-01 20:03:00",
  "metadata": {
    "thoughts": [
      "用户们在讨论天气，这是很自然的闲聊",
      "我没有必要插入这个对话，保持安静比较好"
    ],
    "hasReply": false
  }
}
```

### 机器人回复消息（思考后回复）
```json
{
  "id": "bot_1704110460000",
  "groupId": 789012,
  "userId": 987654321,
  "content": [
    {"type": "text", "data": {"text": "是的，阳光明媚的日子总是让人心情愉快"}}
  ],
  "timestamp": "2024-01-01 20:04:00",
  "metadata": {
    "thoughts": [
      "张三在分享天气很好的感受",
      "这是一个轻松的话题，我可以自然地参与讨论"
    ],
    "hasReply": true
  }
}
```

## 依赖关系

### 类型依赖
- **SendMessageSegment**：来自 `node-napcat-ts` 库的标准消息段类型
- **string**：时间戳使用字符串格式，由 [[timezone_utils]] 生成

### 使用者
- [[session]] - 创建和传递 Message 对象
- [[base_message_handler]] - 处理和存储 Message 对象
- [[active_message_handler]] / [[passive_message_handler]] - 具体的消息处理逻辑

## 扩展性

### metadata 字段扩展
```typescript
metadata?: {
    thoughts?: string[];           // 现有：思考过程
    hasReply?: boolean;           // 现有：回复标志
    replyToMessageId?: string;    // 现有：回复目标
    
    // 可能的扩展字段
    emotion?: string;             // 情感分析结果
    topic?: string;               // 话题分类
    priority?: number;            // 消息优先级
    processedAt?: Date;           // 处理时间
}
```

### 内容类型扩展
- 支持图片、文件、语音等多媒体消息类型
- 可以添加自定义的消息段类型
- 支持富文本和特殊格式消息

## 数据流转

### 创建路径
1. **napcat 事件** → Session.handleMessage()
2. **原始数据解析** → Message 对象
3. **传递给处理器** → MessageHandler.handleMessage()

### 存储路径
1. **加入历史** → BaseMessageHandler.addMessageToHistory()
2. **LRU 管理** → 保持最近 N 条消息
3. **上下文构建** → 转换为 LLM 请求格式

### 传递路径
1. **序列化** → JSON.stringify(message)
2. **LLM 处理** → OpenAI API 调用
3. **响应解析** → 新的 Message 对象（包含 metadata）

## 相关文件
- `src/session.ts` - Message 接口定义和基本处理
- `src/base_message_handler.ts` - Message 历史管理和上下文构建
- `src/active_message_handler.ts` / `src/passive_message_handler.ts` - 具体处理逻辑