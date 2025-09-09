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

### LLM 集成与日志记录
```typescript
protected async processAndReply(): Promise<boolean> {
    let inputForLog = "";
    let status: "success" | "fail" = "fail";
    let llmResponse = "";
    
    try {
        // 1. 构建数据结构和LLM请求
        const chatMessageData = this.buildChatMessageData();
        const chatMessages = this.buildChatMessages();
        
        // 2. 生成美观的输入字符串用于记录
        inputForLog = JSON.stringify(chatMessageData, null, 2);
        
        // 3. 调用 LLM API
        llmResponse = await this.llmClient.oneTurnChat(chatMessages);
        
        // 4. 检查调用结果
        if (llmResponse === "") {
            status = "fail";
            void logger.logLLMCall(status, inputForLog, "LLM调用失败");
            throw new Error("LLM调用失败");
        }
        
        status = "success";
        const { thoughts, reply } = this.parseResponse(llmResponse);

        // 5. 记录成功的LLM调用
        void logger.logLLMCall(status, inputForLog, llmResponse);

        // 6. 记录思考过程并发送回复
        if (thoughts.length > 0) {
            console.log(`[群 ${String(this.groupId)}] LLM 思考:`);
            thoughts.forEach((thought, index) => {
                console.log(`  ${String(index + 1)}. ${thought}`);
            });
        }
        
        if (reply && reply.length > 0) {
            await this.session.sendMessage(reply);
            return true;
        }
        
        return false;
    } catch (error) {
        // 7. 记录失败的LLM调用 - 使用JSON序列化确保复杂错误对象能被完整记录
        const errorMessage = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
        if (inputForLog) {
            void logger.logLLMCall("fail", inputForLog, errorMessage);
        }
        throw error;
    }
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

### 数据结构分离与上下文构建

#### 原始数据结构生成
```typescript
// 用于日志记录的数据结构
interface ChatMessageData {
    role: string;
    content: string | Message | LlmResponseItem[];
}

private buildChatMessageData(): ChatMessageData[] {
    // 使用Handlebars模板生成系统提示
    const systemPrompt = this.promptTemplateManager.generatePrompt({
        botQQ: this.botQQ,
        masterConfig: this.masterConfig,
    });

    const messages: ChatMessageData[] = [
        { role: "system", content: systemPrompt },
    ];

    // 构建历史消息上下文，保持原始对象结构
    this.messageHistory.forEach(msg => {
        if (msg.userId === this.botQQ) {
            // 机器人消息：构建思考链格式但不序列化
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
                    content: responseArray,  // 保持对象结构
                });
            }
        } else {
            // 用户消息：保持Message对象结构
            messages.push({
                role: "user",
                content: msg,  // 保持Message对象结构
            });
        }
    });

    return messages;
}
```

#### API调用格式转换
```typescript
protected buildChatMessages(): ChatCompletionMessageParam[] {
    const messageData = this.buildChatMessageData();
    return messageData.map(msg => ({
        role: msg.role as "system" | "user" | "assistant",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    }));
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

### Handlebars模板系统
```typescript
// 使用模板管理器替代硬编码字符串拼接
protected promptTemplateManager: PromptTemplateManager;

constructor(...) {
    // 初始化模板管理器
    this.promptTemplateManager = new PromptTemplateManager();
}
```

### 模板上下文
```typescript
interface PromptTemplateContext {
    botQQ: number;
    masterConfig?: MasterConfig;
}
```

### 上下文增强
- **Handlebars模板**：使用[[prompt_template_manager]]进行动态生成
- **机器人 QQ 号**：通过`{{botQQ}}`模板变量插入
- **主人信息**：通过条件模板`{{#if masterConfig}}`动态显示
- **群组上下文**：完整的群聊历史和用户信息

## 依赖关系

### 构造时依赖
- [[llm_client]] - LLM API 调用
- [[session]] - 消息发送功能
- [[config_system]] - 主人配置和历史长度配置
- [[prompt_template_manager]] - Handlebars模板管理
- [[logger]] - LLM调用日志记录

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
- **API 错误**：使用JSON序列化记录完整错误信息（避免"[object Object]"问题），记录后重新抛出
- **解析错误**：返回空响应，不发送消息
- **网络错误**：由 [[llm_client]] 处理，同样使用JSON序列化记录详细信息

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