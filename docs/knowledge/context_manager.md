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
    const napcatConfig = this.configManager.getNapcatConfig();
    const masterConfig = this.configManager.getMasterConfig();
    const systemPrompt = this.promptTemplateManager.generatePrompt({
        botQQ: napcatConfig.bot_qq,
        masterConfig,
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
    configManager: ConfigManager,
    promptTemplateManager: PromptTemplateManager,
    maxHistorySize: number,
) {
    this.configManager = configManager;
    this.promptTemplateManager = promptTemplateManager;
    this.maxHistorySize = maxHistorySize;
}
```

### 工厂函数
```typescript
export const newContextManager = (
    configManager: ConfigManager,
    promptTemplateManager: PromptTemplateManager,
    maxHistorySize?: number,
) => {
    const agentConfig = configManager.getAgentConfig();
    const actualMaxHistorySize = maxHistorySize ?? agentConfig?.history_turns ?? 40;
    return new ContextManager(configManager, promptTemplateManager, actualMaxHistorySize);
};
```

工厂函数会自动从 AgentConfig 中读取 `history_turns` 配置作为默认的 `maxHistorySize`。

### 核心属性
- **configManager**: 配置管理器，提供机器人配置和主人配置
- **messageHistory**: 消息历史数组，采用LRU策略
- **maxHistorySize**: 历史消息最大长度（从 AgentConfig 读取或使用默认值 40）
- **promptTemplateManager**: 提示词模板管理器（注入）

## 思考链数据结构

### 类型定义
```typescript
type ThoughtItem = {
    type: "thought",
    content: string,
};

type ChatItem = {
    type: "chat",
    content: SendMessageSegment[],
};

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

### 核心依赖（通过依赖注入）
- [[config_manager]] - 配置管理器，提供机器人和主人配置（注入）
- [[prompt_template_manager]] - Handlebars模板系统（注入）
- [[message_data_model]] - Message接口和相关类型

### 导入的类型
- **SendMessageSegment**: node-napcat-ts的消息段类型
- **ChatMessage**: LLM提供商的统一消息格式（支持工具调用）
- **Message**: 内部消息数据模型

### 使用者
- [[message_handler]] - 主要使用者，通过组合方式使用ContextManager

## 使用示例

### 在MessageHandler中的使用
```typescript
// 在 SessionManager 中创建
const contextManager = newContextManager(this.configManager, this.promptTemplateManager);
const handler = newMessageHandler(session, contextManager, this.llmClientManager);
```

### 使用工厂函数的完整示例
```typescript
// 在 SessionManager 初始化会话时
for (const groupId of this.napcatFacade.getGroupIds()) {
    const session = newSession(groupId, this.napcatFacade);

    // 使用工厂函数创建 ContextManager，自动从配置读取 maxHistorySize
    const contextManager = newContextManager(
        this.configManager,
        this.promptTemplateManager
    );

    const handler = newMessageHandler(session, contextManager, this.llmClientManager);
    session.setMessageHandler(handler);
    this.sessions.set(groupId, session);
}
```

### 手动指定历史长度
```typescript
// 如果需要覆盖配置中的 history_turns，可以传入 maxHistorySize 参数
const contextManager = newContextManager(
    configManager,
    promptTemplateManager,
    100  // 手动指定最大历史长度
);
```

## 相关文件
- `src/context_manager.ts` - 主要实现
- `src/message_handler.ts` - 主要使用者
- `src/prompt_template_manager.ts` - 提示词模板依赖
- `src/session.ts` - Message类型定义