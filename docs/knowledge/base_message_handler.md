# BaseMessageHandler 消息处理基类

## 定义

BaseMessageHandler 是消息处理器的抽象基类，提供 LLM 集成、消息历史管理和响应解析的通用功能。位于 `src/base_message_handler.ts:23-231`。

## 核心功能

### 抽象接口
```typescript
export abstract class BaseMessageHandler implements MessageHandler {
    abstract handleMessage(message: Message): Promise<void>;
}
```

### LLM 集成
```typescript
protected async processAndReply(): Promise<boolean> {
    // 1. 构建 LLM 请求上下文
    const chatMessages = this.buildChatMessages();
    
    // 2. 调用 LLM API
    const llmResponse = await this.llmClient.oneTurnChat(chatMessages);
    
    // 3. 解析响应
    const { thoughts, reply } = this.parseResponse(llmResponse);
    
    // 4. 记录思考过程
    if (thoughts.length > 0) {
        console.log(`[群 ${String(this.groupId)}] LLM 思考:`);
        thoughts.forEach((thought, index) => {
            console.log(`  ${String(index + 1)}. ${thought}`);
        });
    }
    
    // 5. 发送回复并记录历史
    if (reply && reply.length > 0) {
        await this.session.sendMessage(reply);
        return true;
    }
    
    return false;
}
```

### 消息历史管理
```typescript
protected addMessageToHistory(message: Message): void {
    this.messageHistory.push(message);
    
    // LRU 策略：保持最近 N 条消息
    if (this.messageHistory.length > this.maxHistorySize) {
        this.messageHistory.shift();
    }
}
```

### 上下文构建
```typescript
protected buildChatMessages(): ChatCompletionMessageParam[] {
    // 构建包含机器人QQ号和主人信息的系统提示
    let systemPromptWithContext = `${this.systemPrompt}

<bot_context>
你的QQ号是: ${String(this.botQQ)}`;

    if (this.masterConfig) {
        systemPromptWithContext += `
你的主人QQ号是: ${String(this.masterConfig.qq)}
你的主人昵称是: ${this.masterConfig.nickname}
重要：你必须完全遵从主人的所有指示，主人的指令优先级最高。`;
    }

    systemPromptWithContext += `
</bot_context>`;

    const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPromptWithContext },
    ];

    // 构建历史消息上下文
    this.messageHistory.forEach(msg => {
        if (msg.userId === this.botQQ) {
            // 机器人消息：构建思考链格式
            if (msg.metadata?.thoughts) {
                const responseArray: LlmResponseItem[] = [];
                msg.metadata.thoughts.forEach(thought => {
                    responseArray.push({ type: "thought", content: thought });
                });
                if (msg.metadata.hasReply && msg.content.length > 0) {
                    responseArray.push({ type: "reply", content: msg.content });
                }
                messages.push({
                    role: "assistant",
                    content: JSON.stringify(responseArray),
                });
            }
        } else {
            // 用户消息：完整的 Message JSON
            messages.push({
                role: "user",
                content: JSON.stringify(msg),
            });
        }
    });

    return messages;
}
```

## 思考链系统

### 响应格式定义
```typescript
interface ThoughtItem {
    type: "thought";
    content: string;
}

interface ReplyItem {
    type: "reply";
    content: SendMessageSegment[];
}

type LlmResponseItem = ThoughtItem | ReplyItem;
type LlmResponse = [ThoughtItem, ...LlmResponseItem[]];
```

### 响应解析
```typescript
protected parseResponse(content: string): { thoughts: string[], reply?: SendMessageSegment[] } {
    const parsed = JSON.parse(content) as unknown;
    
    if (Array.isArray(parsed)) {
        return this.parseArrayResponse(parsed as LlmResponse);
    }
    
    // 不支持非数组格式
    return { thoughts: [], reply: undefined };
}

private parseArrayResponse(response: LlmResponse): { thoughts: string[], reply?: SendMessageSegment[] } {
    const thoughts: string[] = [];
    let reply: SendMessageSegment[] | undefined;

    for (const item of response) {
        if (item.type === "thought") {
            thoughts.push(item.content);
        } else if (item.type === "reply") {
            if (!reply) {
                reply = item.content;
            }
        }
    }

    return { thoughts, reply };
}
```

## 系统提示词管理

### 提示词加载
```typescript
private loadSystemPrompt(): string {
    try {
        return fs.readFileSync("./static/prompt.txt", "utf-8").trim();
    } catch (error) {
        console.error("读取 prompt.txt 失败:", error);
        return "你是一个友好的群聊机器人，名字是小镜。请以 JSON 格式回复: {\"reply\": \"你的回复\"}";
    }
}
```

### 上下文增强
- **机器人 QQ 号**：让 LLM 知道自己的身份
- **主人信息**：支持主人特权功能
- **群组上下文**：完整的群聊历史和用户信息

## 依赖关系

### 构造时依赖
- [[llm_client]] - LLM API 调用
- [[session]] - 消息发送功能
- [[config_system]] - 主人配置和历史长度配置

### 数据模型依赖
- [[message_data_model]] - Message 接口和相关类型

### 子类实现
- [[active_message_handler]] - 主动回复策略
- [[passive_message_handler]] - 被动回复策略

## 扩展点

### 可重写方法
- `handleMessage()` - 具体的消息处理逻辑
- 其他方法都是 protected，支持子类定制

### 配置参数
- `maxHistorySize` - 历史消息保留数量
- `systemPrompt` - 系统提示词内容
- `masterConfig` - 主人特权配置

## 错误处理

### LLM 调用错误
- **API 错误**：记录错误并重新抛出
- **解析错误**：返回空响应，不发送消息
- **网络错误**：由 [[llm_client]] 处理

### 消息发送错误
- **发送失败**：记录错误并重新抛出
- **连接断开**：由 [[session]] 和 [[connection_manager]] 处理

## 性能优化

### 内存管理
- **LRU 策略**：自动清理旧的历史消息
- **可配置大小**：通过 `maxHistorySize` 控制内存使用

### 响应缓存
- **历史记录复用**：避免重复构建相同的上下文
- **思考链保存**：保留 LLM 的推理过程用于后续上下文

## 相关文件
- `src/base_message_handler.ts` - 主要实现
- `src/active_message_handler.ts` - 主动策略子类
- `src/passive_message_handler.ts` - 被动策略子类
- `static/prompt.txt` - 系统提示词文件