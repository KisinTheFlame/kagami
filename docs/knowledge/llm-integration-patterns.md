# LLM 集成模式知识点

## 被动响应模式

### 设计理念

被动响应模式是一种基于触发条件的 LLM 集成策略，机器人只在特定条件下（如被 @ 提及）才启动 LLM 推理，避免了对每条消息都进行 LLM 调用的资源浪费。

### 核心特性

1. **触发条件明确**
   - 仅在机器人被 @ 时触发
   - 避免无意义的 LLM 调用
   - 降低 API 成本和延迟

2. **上下文感知**
   - 维护群聊历史记录
   - 构建多轮对话上下文
   - 保持对话连贯性

3. **群组隔离**
   - 每个群组独立的对话上下文
   - 避免跨群组信息泄露
   - 支持群组特定的对话风格

## 消息历史管理

### LRU 策略

使用最近最少使用（Least Recently Used）策略管理消息历史：

```typescript
private addMessageToHistory(message: Message): void {
    this.messageHistory.push(message);
    
    // 使用 LRU 策略，保持最近 N 条消息
    if (this.messageHistory.length > this.maxHistorySize) {
        this.messageHistory.shift();  // 移除最旧的消息
    }
}
```

### 历史记录结构

```typescript
interface Message {
    id: string;                    // 消息唯一标识
    groupId: number;               // 群组 ID
    userId: number;                // 发送者 QQ 号
    userNickname?: string;         // 发送者昵称
    content: string;               // 消息内容
    timestamp: Date;               // 时间戳
    mentions?: number[];           // @ 提及列表
}
```

### 内存优化

- 限制历史记录条数（默认 40 条）
- 仅保存必要的消息字段
- 及时清理过期记录

## 上下文构建策略

### 对话格式转换

将群聊消息转换为 LLM 可理解的对话格式：

```typescript
private buildChatMessages(): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: this.systemPrompt },
    ];

    this.messageHistory.forEach(msg => {
        if (msg.userId === this.botQQ) {
            // 机器人消息作为 assistant
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

### 身份识别

- 机器人回复标记为 `assistant` 角色
- 用户消息标记为 `user` 角色，包含昵称
- 系统提示词作为 `system` 角色

## System Prompt 设计

### 提示词结构

```text
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

### 设计原则

1. **身份定位明确**：明确机器人名字和角色
2. **行为约束**：限制回复长度和风格
3. **输出格式化**：使用 JSON 格式便于解析
4. **异常处理**：提供兜底回复策略

## 错误处理机制

### 分层错误处理

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

### 错误类型处理

1. **LLM API 错误**
   - 网络超时
   - API 限流
   - 服务不可用

2. **响应解析错误**
   - JSON 格式错误
   - 缺少 reply 字段
   - 内容格式异常

3. **消息发送错误**
   - 群组权限不足
   - 网络连接问题

### 容错策略

- 静默失败，不阻塞其他功能
- 详细的错误日志记录
- 提供默认回复内容

## 性能优化

### 异步处理

```typescript
async handleMessage(message: Message): Promise<void> {
    // 1. 立即保存消息到历史记录
    this.addMessageToHistory(message);

    // 2. 检查触发条件
    if (message.mentions?.includes(this.botQQ)) {
        // 3. 异步处理 LLM 请求，不阻塞消息接收
        try {
            const response = await this.generateReply();
            await this.sendReply(response);
        } catch (error) {
            // 错误处理
        }
    }
}
```

### 资源管理

- 合理控制历史记录大小
- 避免内存泄漏
- 及时释放不需要的资源

## 可扩展性设计

### 配置灵活性

```typescript
constructor(
    llmClient: LlmClient,
    botQQ: number,
    groupId: number,
    session: Session,
    maxHistorySize = 40,  // 可配置的历史记录大小
) {
    this.maxHistorySize = maxHistorySize;
    this.systemPrompt = this.loadSystemPrompt();  // 可配置的提示词
}
```

### 扩展点

1. **触发条件扩展**
   - 关键词触发
   - 时间触发
   - 情感触发

2. **上下文增强**
   - 长期记忆
   - 用户画像
   - 知识库集成

3. **输出格式扩展**
   - 富媒体消息
   - 多模态输出
   - 结构化回复

## 最佳实践

### 提示词优化

1. **明确性**：清晰定义机器人身份和行为
2. **约束性**：限制回复长度和格式
3. **示例性**：提供良好的回复示例
4. **测试性**：在不同场景下测试提示词效果

### 历史管理

1. **适量保存**：平衡上下文质量和资源消耗
2. **及时清理**：定期清理过期或无用信息
3. **隐私保护**：避免保存敏感信息

### 错误处理

1. **静默失败**：不影响核心功能
2. **详细日志**：便于问题排查
3. **优雅降级**：提供备用方案

### 性能监控

1. **响应时间**：监控 LLM API 调用延迟
2. **成功率**：监控回复生成成功率
3. **资源使用**：监控内存和 CPU 使用情况