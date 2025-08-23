# LLM 对话集成实现

## 实现概述

实现了基于 LLM 的智能群聊对话功能，支持被动触发的自然语言交互。当机器人被 @ 提及时，会根据群聊历史记录生成符合语境的智能回复。

## 架构设计

### 核心组件

#### PassiveMessageHandler 类 (`src/passive_message_handler.ts`)

负责处理群组消息并提供 LLM 对话功能：

- **消息历史管理**：使用 LRU 策略维护每个群组的聊天历史
- **@ 触发机制**：仅在机器人被明确 @ 时才触发 LLM 回复
- **上下文构建**：将群聊历史转换为 LLM 可理解的对话格式
- **响应解析**：解析 LLM 的 JSON 格式回复并处理错误

#### 系统提示词 (`static/prompt.txt`)

定义了机器人的行为规范和回复格式：

```
你是一个友好的 QQ 群聊机器人，名字是 Kagami。
请根据群聊历史消息，生成简洁、自然的回复。

要求：
- 回复要符合群聊氛围，语调轻松友好
- 长度控制在 1-2 句话
- 不要重复历史消息中的内容
- 如果没有足够信息回复，可以问问题或表达困惑

请以 JSON 格式回复：
{
  "reply": "你的回复内容"
}
```

### 技术特性

#### 消息历史管理

```typescript
interface Message {
    id: string;
    groupId: number;
    userId: number;
    userNickname?: string;
    content: string;
    timestamp: Date;
    mentions?: number[];
    rawMessage?: { type: string; data: any }[];
}
```

- 每个群组维护独立的消息历史记录
- 使用 LRU 策略限制历史记录长度（默认 40 条）
- 同时记录用户消息和机器人回复

#### 对话上下文构建

```typescript
private buildChatMessages(): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: this.systemPrompt },
    ];

    this.messageHistory.forEach(msg => {
        if (msg.userId === this.botQQ) {
            // Bot 的消息作为 assistant
            messages.push({
                role: "assistant",
                content: msg.content,
            });
        } else {
            // 用户消息作为 user，包含昵称信息
            messages.push({
                role: "user",
                content: `${msg.userNickname ?? String(msg.userId)}: ${msg.content}`,
            });
        }
    });

    return messages;
}
```

#### 触发条件

- **被动触发**：仅在机器人被 @ 时才响应
- **群组隔离**：每个群组的对话上下文完全独立
- **错误容错**：LLM 请求失败时不影响其他功能

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

## 工作流程

### 消息处理流程

1. **接收消息**：Session 接收到群组消息
2. **保存历史**：PassiveMessageHandler 将消息添加到历史记录
3. **检查触发**：检查消息是否 @ 了机器人
4. **构建上下文**：将历史记录转换为 LLM 对话格式
5. **LLM 请求**：调用 LlmClient 生成回复
6. **解析响应**：从 JSON 格式中提取回复内容
7. **发送回复**：通过 Session 发送消息到群组
8. **记录回复**：将机器人回复也添加到历史记录

### 错误处理

```typescript
try {
    const chatMessages = this.buildChatMessages();
    const llmResponse = await this.llmClient.oneTurnChat(chatMessages);
    const reply = this.parseResponse(llmResponse);
    await this.session.sendMessage(reply);
} catch (error) {
    console.error(`[群 ${String(this.groupId)}] LLM 回复失败:`, error);
    // 静默失败，不影响其他功能
}
```

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

## 扩展性

### 未来可扩展功能

1. **多轮对话记忆**：维护更长期的对话上下文
2. **个性化回复**：基于用户历史行为调整回复风格
3. **情感分析**：根据群聊氛围调整回复语调
4. **主题检测**：识别讨论话题并提供相关信息
5. **多模态支持**：处理图片、链接等富媒体内容
6. **定时主动发言**：在特定条件下主动参与讨论

### 配置灵活性

- System prompt 可通过文件轻松修改
- 历史记录长度可配置
- 支持不同群组使用不同配置（未来扩展）

## 部署注意事项

1. **LLM 服务**：确保 LLM API 服务可用且配置正确
2. **提示词文件**：确保 `static/prompt.txt` 文件存在且可读
3. **网络延迟**：LLM 请求可能有一定延迟，不影响其他功能
4. **API 限制**：注意 LLM API 的频率限制和配额管理
5. **内容审核**：建议添加内容过滤以确保回复内容安全合规