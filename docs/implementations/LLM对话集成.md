# LLM 对话集成实现

## 实现概述

实现了基于 LLM 的智能群聊对话功能，支持被动触发的自然语言交互。当机器人被 @ 提及时，会根据群聊历史记录生成符合语境的智能回复。

**2024年重大架构升级**：系统已重构为完全结构化的消息处理架构，LLM 可以完整理解和生成包含 @ 提及等复杂格式的消息。

## 架构设计

### 核心组件

#### PassiveMessageHandler 类 (`src/passive_message_handler.ts`)

负责处理群组消息并提供 LLM 对话功能：

- **消息历史管理**：使用 LRU 策略维护每个群组的聊天历史
- **@ 触发机制**：通过遍历消息结构检测机器人是否被 @ 
- **上下文构建**：将完整的 Message 对象序列化为 JSON 传递给 LLM
- **响应解析**：解析 LLM 的结构化回复并发送到群组

#### 系统提示词 (`static/prompt.txt`)

定义了机器人的行为规范和新的结构化消息处理：

```
你是一个友好的 QQ 群聊参与者，名字是小镜。
请根据群聊历史消息，生成简洁、自然的回复。

## 消息格式说明

你将接收到 JSON 格式的用户消息，包含以下字段：
- id: 消息唯一标识
- groupId: 群组 ID
- userId: 用户 QQ 号
- userNickname: 用户昵称
- content: 消息内容数组，每个元素包含：
  - type: 消息类型（"text" 文本、"at" @提及等）
  - data: 具体数据
    - text: 文本内容
    - qq: 被@的QQ号
- timestamp: 发送时间

## 回复要求

请以 JSON 格式回复，使用 reply 字段包含消息内容数组：

{
  "reply": [
    {"type": "text", "data": {"text": "你的回复内容"}}
  ]
}

如果需要@某人，可以这样回复：
{
  "reply": [
    {"type": "at", "data": {"qq": "123456"}},
    {"type": "text", "data": {"text": " 你好！"}}
  ]
}
```

### 技术特性

#### 消息数据结构

```typescript
export interface Message {
    id: string;
    groupId: number;
    userId: number;
    userNickname?: string;
    content: SendMessageSegment[];  // 结构化消息内容
    timestamp: Date;
}
```

**重大架构改进**：
- **移除了冗余字段**：不再有 `mentions` 数组和纯文本 `content` 字段
- **统一结构化格式**：接收和发送都使用相同的 `SendMessageSegment[]` 格式
- **完整语义保留**：@ 提及、文本等所有信息都保持在结构化格式中

#### 对话上下文构建

```typescript
protected buildChatMessages(): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: this.systemPrompt },
    ];

    this.messageHistory.forEach(msg => {
        if (msg.userId === this.botQQ) {
            // Bot 的消息作为 assistant - 传递结构化格式
            messages.push({
                role: "assistant", 
                content: JSON.stringify({ reply: msg.content }),
            });
        } else {
            // 用户消息作为 user - 传递完整的 Message JSON
            messages.push({
                role: "user",
                content: JSON.stringify(msg),
            });
        }
    });

    return messages;
}
```

**架构升级优势**：
- **完整上下文**：LLM 能看到用户昵称、@ 信息、时间戳等所有上下文
- **结构化理解**：LLM 能准确理解消息的各个组成部分
- **智能回复**：LLM 可以生成包含 @ 提及的复杂回复

#### 触发检测机制

```typescript
private isBotMentioned(message: Message): boolean {
    return message.content.some(item => 
        item.type === "at" && item.data.qq === this.botQQ.toString(),
    );
}
```

- **精确检测**：直接从消息结构中检测 @ 提及
- **类型安全**：使用 TypeScript 强类型确保数据正确性
- **扩展性强**：可轻松支持更多触发条件

## 消息处理流程

### 完整工作流程

1. **接收消息**：Session 接收群组消息，保持完整的结构化格式
2. **保存历史**：PassiveMessageHandler 将完整 Message 对象添加到历史记录
3. **检查触发**：遍历 `content` 数组检查是否包含对机器人的 @ 
4. **构建上下文**：将完整 Message 对象序列化为 JSON 传递给 LLM
5. **LLM 处理**：LLM 接收完整上下文，生成结构化回复
6. **解析响应**：从 LLM 的 `reply` 数组中提取结构化消息
7. **发送消息**：将结构化消息直接发送到群组
8. **记录回复**：将机器人的结构化回复添加到历史记录

### 消息格式示例

**用户发送**："@小镜 今天天气怎么样？"

**LLM 接收的 JSON**：
```json
{
  "id": "123456",
  "userId": 789012,
  "userNickname": "张三",
  "content": [
    {"type": "at", "data": {"qq": "987654321"}},
    {"type": "text", "data": {"text": " 今天天气怎么样？"}}
  ],
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**LLM 生成的回复**：
```json
{
  "reply": [
    {"type": "at", "data": {"qq": "789012"}},
    {"type": "text", "data": {"text": " 今天天气不错，适合出门散步！"}}
  ]
}
```

**群组中显示**："@张三 今天天气不错，适合出门散步！"

## 配置参数

### Agent 配置 (可选)

```yaml
agent:
  history_turns: 40    # 保留的历史消息条数，默认 40
```

### 机器人 QQ 号配置

```yaml
napcat:
  bot_qq: 123456789    # 机器人的 QQ 号码，用于 @ 检测
```

## 架构优势

### 语义完整性

- **完整上下文**：LLM 能看到谁发送消息、何时发送、@ 了谁等完整信息
- **精准理解**：能准确理解复杂的群聊对话场景
- **智能回应**：可以针对 @ 提及做出恰当的回应

### 扩展性

- **多媒体支持**：架构已为图片、文件等消息类型做好准备
- **富文本回复**：LLM 可以生成包含 @ 、表情等复杂格式的回复
- **类型安全**：使用 TypeScript 强类型系统确保数据结构正确

### 性能优化

- **消除冗余**：移除了重复的数据字段，减少内存占用
- **统一格式**：接收和发送使用相同数据结构，减少转换开销
- **精确触发**：避免不必要的 LLM 调用

## 集成方式

### SessionManager 集成

```typescript
// 为每个 Session 创建对应的 PassiveMessageHandler
const handler = new PassiveMessageHandler(
    this.llmClient,
    this.botQQ,
    groupId,
    session,
    this.agentConfig?.history_turns ?? 40,
);

session.setMessageHandler(handler);
```

### 独立性保证

- 每个群组有独立的 PassiveMessageHandler 实例
- 消息历史记录完全隔离
- LLM 对话上下文不会跨群组混淆

## 未来扩展能力

### 即将支持的功能

1. **多媒体消息**：图片、文件、语音等消息类型
2. **表情回复**：LLM 可以使用 QQ 表情增强回复效果
3. **回复引用**：支持回复特定消息的功能
4. **群组个性化**：不同群组可以有不同的机器人人设

### 配置灵活性

- System prompt 可通过文件轻松修改
- 历史记录长度可配置
- 消息格式完全基于 node-napcat-ts 标准

## 部署注意事项

1. **LLM 服务**：确保 LLM API 服务可用且配置正确
2. **提示词文件**：确保 `static/prompt.txt` 文件存在且格式正确
3. **网络延迟**：LLM 请求可能有一定延迟，不影响其他功能
4. **API 限制**：注意 LLM API 的频率限制和配额管理
5. **内容审核**：建议添加内容过滤以确保回复内容安全合规
6. **类型兼容**：确保所有依赖的 node-napcat-ts 版本兼容