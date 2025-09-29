# MessageHandler 统一消息处理器

## 定义

MessageHandler 是统一的消息处理器类，整合了原有的 BaseMessageHandler、ActiveMessageHandler 功能，提供完整的 LLM 集成和并发控制。经过重构后，消息历史管理职责已分离到 [[context_manager]]，实现了更好的职责分离。位于 `src/message_handler.ts`。

## 核心功能

### 完整的消息处理流程
```typescript
async handleMessage(message: Message): Promise<void> {
    // 1. 立即加入历史数组（委托给ContextManager）
    this.contextManager.addMessageToHistory(message);

    // 2. 标记有新消息（每次都设置）
    this.hasPendingMessages = true;

    // 3. 尝试启动处理（如果已在处理则直接返回）
    await this.tryProcessAndReply();
}
```

### 支持工具调用的 LLM 集成
```typescript
protected async processAndReply(): Promise<void> {
    try {
        // 构建数据结构和LLM请求（委托给ContextManager）
        const chatMessages = this.contextManager.buildChatMessages();

        const llmResponse = await this.llmClientManager.callWithFallback({
            messages: chatMessages,
            tools: [],  // 当前暂不使用工具调用
            outputFormat: "json"
        });

        // 处理LLM响应（支持工具调用）
        if (llmResponse.content) {
            const { thoughts, reply } = this.parseResponse(llmResponse.content);

            // 记录思考过程并发送回复
            if (thoughts.length > 0) {
                console.log(`[群 ${String(this.groupId)}] LLM 思考:`);
                thoughts.forEach((thought, index) => {
                    console.log(`  ${String(index + 1)}. ${thought}`);
                });
            }

            // 存储bot消息到历史（委托给ContextManager）
            const botMessage: Message = {
                type: "bot_msg",
                value: { thoughts, chat: reply }
            };
            this.contextManager.addMessageToHistory(botMessage);

            // 发送回复
            if (reply && reply.length > 0) {
                await this.session.sendMessage(reply);
            }
        }

        // 处理工具调用（未来功能）
        if (llmResponse.toolCalls) {
            console.log("LLM 请求调用工具:", llmResponse.toolCalls);
            // TODO: 实现工具调用处理逻辑
        }
    } catch (error) {
        console.error("LLM 处理失败:", error);
        throw error;
    }
}
```


## 并发控制机制

### 栈安全的实时处理
```typescript
private async tryProcessAndReply(): Promise<void> {
    // 如果已经在处理中，直接返回（关键：避免并发）
    if (this.isLlmProcessing) {
        return;
    }

    this.isLlmProcessing = true;
    try {
        // 持续处理直到没有新消息
        while (this.hasPendingMessages) {
            this.hasPendingMessages = false;


            // LLM处理
            await this.processAndReply();
        }
    } finally {
        this.isLlmProcessing = false;
    }
}
```

### 并发安全特性
- **零递归设计**：使用while循环代替递归调用，避免栈溢出
- **单一处理者**：通过 `isLlmProcessing` 确保同时只有一个处理循环
- **通知机制**：每条消息只是"通知"有新消息，不创建新的处理流程
- **批量感知**：while循环能处理期间累积的所有新消息

## 架构重构

### 职责分离
经过重构，MessageHandler 的职责更加聚焦：
- **消息处理流程控制**: 并发控制、处理循环
- **LLM 集成**: 调用支持工具调用的 LLM 并处理响应
- **错误处理**: 异常处理和日志记录
- **工具调用预留**: 为未来的工具调用功能预留接口

上下文管理职责已完全委托给 [[context_manager]]：
- **消息历史管理**: LRU策略和历史记录
- **上下文构建**: buildChatMessages() 方法，支持工具调用消息格式
- **数据封装**: 只读访问和数据安全

### 组合模式
```typescript
export class MessageHandler implements IMessageHandler {
    private contextManager: ContextManager;
    protected session: Session;
    private llmClientManager: LlmClientManager;

    constructor(
        session: Session,
        contextManager: ContextManager,
        llmClientManager: LlmClientManager,
    ) {
        this.session = session;
        this.contextManager = contextManager;
        this.llmClientManager = llmClientManager;
    }
}
```

### 工厂函数
```typescript
export const newMessageHandler = (
    session: Session,
    contextManager: ContextManager,
    llmClientManager: LlmClientManager,
) => {
    return new MessageHandler(session, contextManager, llmClientManager);
};
```

## 思考链系统

### 响应格式定义
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
type LlmResponse = [ThoughtItem, ...LlmResponseItem[]];
```

### 响应解析
```typescript
protected parseResponse(content: string): { thoughts: string[], reply?: SendMessageSegment[] } {
    try {
        const parsed = JSON.parse(content) as unknown;

        if (Array.isArray(parsed)) {
            return this.parseArrayResponse(parsed as LlmResponse);
        }

        console.error("不支持的LLM响应格式，期望数组格式");
        return { thoughts: [], reply: undefined };
    } catch (error) {
        console.error("解析 LLM 响应失败:", error);
        return { thoughts: [], reply: undefined };
    }
}

private parseArrayResponse(response: LlmResponse): { thoughts: string[], reply?: SendMessageSegment[] } {
    const thoughts: string[] = [];
    let reply: SendMessageSegment[] | undefined;

    for (const item of response) {
        if (item.type === "thought") {
            thoughts.push(item.content);
        } else {
            if (reply) {
                console.warn("发现多个reply项，只使用第一个");
            } else {
                reply = item.content;
            }
        }
    }

    return { thoughts, reply };
}
```

## 系统提示词管理

### 委托给ContextManager
系统提示词管理现在完全由 [[context_manager]] 负责：
- 使用 [[prompt_template_manager]] 进行Handlebars模板管理
- 支持动态插入机器人QQ号、主人信息、当前时间
- 提供完整的群聊上下文和用户信息
- MessageHandler通过 `contextManager.buildChatMessages()` 获取完整上下文

## 架构简化

### 合并前的复杂架构
- `BaseMessageHandler`（抽象基类）+ `ActiveMessageHandler`（主动策略）+ `PassiveMessageHandler`（被动策略）
- 需要策略选择配置 `message_handler_type`
- 继承关系复杂，维护成本高

### 重构后的模块化架构
- 单一的 `MessageHandler` 具体类，职责更聚焦
- **MessageHandler**: LLM集成 + 并发控制 + 消息处理流程
- **ContextManager**: 消息历史管理 + 上下文构建 + 提示词生成
- 通过组合模式实现职责分离，代码结构更清晰

## 生命周期管理

### 资源清理
```typescript
destroy(): void {
    // 清理资源
}
```

## 依赖关系

### 核心依赖（通过依赖注入）
- [[llm_client_manager]] - LLM API 调用和模型降级（注入）
- [[context_manager]] - 上下文管理和历史记录（注入）
- [[session]] - 消息发送功能（注入）

### 数据模型依赖
- [[message_data_model]] - Message 接口和相关类型
- [[llm_function_calling]] - 工具调用类型定义（OneTurnChatRequest, LlmResponse）

## 配置参数

### BehaviorConfig 集成
```typescript
interface BehaviorConfig {
    message_handler_type: "active" | "passive";
    // 注：已移除体力系统相关配置
}
```

## 错误处理

### LLM 调用错误
- **API 错误**：记录完整错误详情到数据库后重新抛出
- **解析错误**：返回空响应，不发送消息
- **网络错误**：从 [[llm_client]] 传递具体网络错误信息


### 消息发送错误
- **发送失败**：记录错误并重新抛出
- **连接断开**：由 [[session]] 和 [[connection_manager]] 处理

## 性能优化

### 内存管理
- **LRU 策略**：自动清理旧的历史消息
- **可配置大小**：通过 `maxHistorySize` 控制内存使用

### 响应性能
- **栈安全设计**：无论消息频率多高都不会栈溢出
- **批量处理**：while循环高效处理累积的新消息
- **并发保护**：避免重复LLM调用的资源浪费

## 使用示例

### 在SessionManager中的使用
```typescript
// 使用工厂函数创建 MessageHandler
const session = newSession(groupId, this.napcatFacade);
const contextManager = newContextManager(this.configManager, this.promptTemplateManager);
const handler = newMessageHandler(session, contextManager, this.llmClientManager);

session.setMessageHandler(handler);
```

## 相关文件
- `src/message_handler.ts` - 主要实现
- `src/session_manager.ts` - 使用MessageHandler的地方
- `src/energy_manager.ts` - 体力管理依赖