# ContextManager 上下文管理器

## 定义

ContextManager 是专门负责消息上下文管理的类，从 [[message_handler]] 中分离出来，实现了单一职责原则。位于 `src/context_manager.ts`，专注于消息历史管理和 LLM 数据准备。

## 核心功能

### 消息历史管理
```typescript
addMessageToHistory(message: Message): void {
    this.messageHistory.push(message);

    // 使用 LRU 策略，保持最近 N 条消息
    if (this.messageHistory.length > this.maxHistorySize) {
        this.messageHistory.shift();
    }
}
```

### LLM 上下文构建
```typescript
buildChatMessages(): ChatMessage[] {
    // 使用Handlebars模板生成系统提示
    const systemPrompt = this.promptTemplateManager.generatePrompt({
        botQQ: this.botQQ,
        masterConfig: this.masterConfig,
        currentTime: getShanghaiTimestamp(),
    });

    const messages: ChatMessage[] = [
        {
            role: "system",
            content: [{ type: "text", value: systemPrompt }],
        },
    ];

    this.messageHistory.forEach(msg => {
        switch (msg.type) {
            case "bot_msg": {
                // Bot 的消息作为 assistant
                const responseArray: LlmResponseItem[] = [];

                // 添加所有thoughts
                msg.value.thoughts.forEach(thought => {
                    responseArray.push({ type: "thought", content: thought });
                });

                // 添加chat（如果有）
                if (msg.value.chat && msg.value.chat.length > 0) {
                    responseArray.push({ type: "chat", content: msg.value.chat });
                }

                messages.push({
                    role: "assistant",
                    content: [{ type: "text", value: JSON.stringify(responseArray) }],
                });
                break;
            }
            case "group_msg": {
                // 用户消息作为 user - 使用自然语言格式的chat字段
                messages.push({
                    role: "user",
                    content: [{ type: "text", value: msg.value.chat }],
                });
                break;
            }
        }
    });

    return messages;
}
```

### 只读访问接口
```typescript
getMessageHistory(): readonly Message[] {
    return this.messageHistory;
}
```

## 构造函数与配置

### 初始化参数
```typescript
constructor(
    botQQ: number,
    groupId: number,
    masterConfig?: MasterConfig,
    maxHistorySize = 40,
) {
    this.botQQ = botQQ;
    this.masterConfig = masterConfig;
    this.maxHistorySize = maxHistorySize;
    this.promptTemplateManager = new PromptTemplateManager();
}
```

### 核心属性
- **botQQ**: 机器人QQ号，用于生成系统提示词
- **messageHistory**: 消息历史数组，采用LRU策略
- **maxHistorySize**: 历史消息最大长度，默认40条
- **promptTemplateManager**: 提示词模板管理器
- **masterConfig**: 主人配置信息（可选）

## 思考链数据结构

### 类型定义
```typescript
interface ThoughtItem {
    type: "thought";
    content: string;
}

interface ChatItem {
    type: "chat";
    content: SendMessageSegment[];
}

type LlmResponseItem = ThoughtItem | ChatItem;
```

### 数据转换
- **用户消息**: 转换为 `role: "user"` 的自然语言格式
- **机器人消息**: 转换为 `role: "assistant"` 的结构化JSON格式，包含思考链
- **系统消息**: 通过 [[prompt_template_manager]] 生成动态提示词

## 架构优势

### 单一职责
- **专注上下文管理**: 只负责消息历史和LLM数据准备
- **职责明确**: 与消息处理流程完全分离
- **易于测试**: 纯数据操作，便于单元测试

### 封装性
- **私有属性**: 所有内部状态都是私有的
- **受控访问**: 通过公共方法控制数据操作
- **只读接口**: `getMessageHistory()` 提供安全的数据访问

### 可复用性
- **独立性**: 不依赖具体的消息处理逻辑
- **配置灵活**: 支持不同的历史长度和配置
- **模块化**: 可以在不同上下文中复用

## 内存管理

### LRU 策略
```typescript
// 自动清理旧消息，保持内存使用稳定
if (this.messageHistory.length > this.maxHistorySize) {
    this.messageHistory.shift();
}
```

### 性能特性
- **常数时间添加**: 数组push操作
- **常数时间清理**: 数组shift操作
- **可配置大小**: 通过maxHistorySize控制内存使用
- **无内存泄漏**: 自动清理超出限制的历史记录

## 依赖关系

### 核心依赖
- [[prompt_template_manager]] - Handlebars模板系统
- [[message_data_model]] - Message接口和相关类型
- [[config_system]] - MasterConfig配置类型

### 导入的类型
- **SendMessageSegment**: node-napcat-ts的消息段类型
- **ChatMessage**: LLM提供商的统一消息格式（支持工具调用）
- **Message**: 内部消息数据模型
- **MasterConfig**: 主人配置类型

### 使用者
- [[message_handler]] - 主要使用者，通过组合方式使用ContextManager

## 使用示例

### 在MessageHandler中的使用
```typescript
export class MessageHandler implements IMessageHandler {
    private contextManager: ContextManager;
    protected session: Session;

    constructor(
        botQQ: number,
        groupId: number,
        session: Session,
        masterConfig?: MasterConfig,
        maxHistorySize = 40,
    ) {
        this.session = session;
        this.contextManager = new ContextManager(botQQ, groupId, masterConfig, maxHistorySize);
    }

    async handleMessage(message: Message): Promise<void> {
        // 添加消息到历史
        this.contextManager.addMessageToHistory(message);

        // 处理消息...
        await this.tryProcessAndReply();
    }

    protected async processAndReply(): Promise<void> {
        // 构建LLM上下文
        const chatMessages = this.contextManager.buildChatMessages();

        // 调用LLM（支持模型降级）
        const request: OneTurnChatRequest = {
            messages: chatMessages,
            tools: [],
            outputFormat: "json"
        };
        const llmResponse = await llmClientManager.callWithFallback(request);

        // 将响应添加到历史
        const botMessage: Message = {
            type: "bot_msg",
            value: { thoughts, chat: reply },
        };
        this.contextManager.addMessageToHistory(botMessage);
    }
}
```

### 独立使用示例
```typescript
// 创建上下文管理器
const contextManager = new ContextManager(
    123456789,  // botQQ
    987654321,  // groupId
    masterConfig,
    50  // maxHistorySize
);

// 添加用户消息
const userMessage: Message = {
    type: "group_msg",
    value: {
        id: "msg123",
        userId: 111111,
        userNickname: "用户名",
        chat: "Hello, bot!",
        timestamp: "2024-01-01 12:00:00"
    }
};
contextManager.addMessageToHistory(userMessage);

// 构建LLM上下文
const chatMessages = contextManager.buildChatMessages();

// 获取历史记录（只读）
const history = contextManager.getMessageHistory();
console.log(`当前历史记录数量: ${history.length}`);
```

## 相关文件
- `src/context_manager.ts` - 主要实现
- `src/message_handler.ts` - 主要使用者
- `src/prompt_template_manager.ts` - 提示词模板依赖
- `src/session.ts` - Message类型定义