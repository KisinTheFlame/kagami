# LLM Function Calling 工具调用系统

## 定义

LLM Function Calling 是 Kagami 新增的工具调用支持系统，允许 LLM 在对话中主动调用工具函数来获取信息或执行操作。位于 `src/llm_providers/types.ts`，提供了完整的工具调用类型定义和接口规范。

## 核心类型系统

### 工具参数类型定义
```typescript
export type ToolParam =
    | {
        type: "string",
        description: string,
        enum?: string[],
    }
    | {
        type: "number" | "integer",
        description: string,
        enum?: number[],
    }
    | {
        type: "boolean",
        description: string,
    }
    | {
        type: "array",
        description: string,
        items: ToolParam,
    }
    | {
        type: "object",
        description: string,
        properties: Record<string, ToolParam>,
        required?: string[],
    };
```

### 工具定义接口
```typescript
export type Tool = {
    name: string,  // 函数名，必须是合法的标识符
    description: string,  // 函数功能描述，供 LLM 理解何时调用
    parameters: ToolParam & { type: "object" },
};
```

### 工具调用请求
```typescript
export type ToolCall = {
    id: string,  // 工具调用的唯一标识符
    function: {
        name: string,  // 要调用的函数名
        arguments: Record<string, unknown>,  // 结构化参数对象
    },
};
```

## 扩展的消息类型

### ChatMessage 联合类型
```typescript
export type ChatMessage =
    | {
        role: "system",
        content: ChatMessagePart[],
    }
    | {
        role: "user",
        content: ChatMessagePart[],
    }
    | {
        role: "assistant",
        content: ChatMessagePart[],
        toolCalls?: ToolCall[],  // LLM 决定调用工具时存在
    }
    | {
        role: "tool",
        toolCallId: string,  // 对应的工具调用 ID
        name?: string,  // 工具名称
        response: Record<string, unknown>, // 响应体
    };
```

### 消息内容部分
```typescript
export type ChatMessagePart = {
    type: "text",
    value: string,
};
```

## LLM 提供商接口

### 统一请求接口
```typescript
export type OneTurnChatRequest = {
    messages: ChatMessage[],
    tools: Tool[],
    outputFormat: OutputFormat,
    toolChoice?: "auto" | "required" | "none",
};
```

### 工具调用模式控制
`toolChoice` 参数用于控制 LLM 的工具调用行为:

- **`"auto"`**: 由 LLM 自主决定是否调用工具（默认模式）
- **`"required"`**: 强制 LLM 必须调用至少一个工具
- **`"none"`**: 禁止 LLM 调用工具，仅返回文本回复

#### 提供商映射
不同 LLM 提供商对 toolChoice 的实现方式:

**OpenAI**: 直接使用 `tool_choice` 参数
```typescript
requestParams.tool_choice = toolChoice; // "auto" | "required" | "none"
```

**Google GenAI**: 通过 `FunctionCallingConfigMode` 映射
```typescript
const toolCallModeMapping: Record<string, FunctionCallingConfigMode> = {
    auto: FunctionCallingConfigMode.AUTO,
    required: FunctionCallingConfigMode.ANY,
    none: FunctionCallingConfigMode.NONE,
};
```

### 响应解析结果
```typescript
export type LlmResponse = {
    content?: string,  // 文本回复内容
    toolCalls?: ToolCall[],  // 工具调用请求（如果有）
};
```

### 扩展的提供商接口
```typescript
export type LlmProvider = {
    /**
     * 执行一轮对话，支持工具调用
     * @param model 模型名称
     * @param request 对话请求参数
     * @returns LLM 的响应内容
     */
    oneTurnChat(model: string, request: OneTurnChatRequest): Promise<LlmResponse>,
};
```

## 工具调用流程

### 1. 工具注册
```typescript
const tools: Tool[] = [
    {
        name: "get_weather",
        description: "获取指定城市的天气信息",
        parameters: {
            type: "object",
            properties: {
                city: {
                    type: "string",
                    description: "城市名称"
                },
                unit: {
                    type: "string",
                    description: "温度单位",
                    enum: ["celsius", "fahrenheit"]
                }
            },
            required: ["city"]
        }
    }
];
```

### 2. 构建请求
```typescript
const request: OneTurnChatRequest = {
    messages: chatMessages,
    tools: tools,
    outputFormat: "json",
    toolChoice: "auto"  // 可选: "auto" | "required" | "none"
};
```

**使用场景**:
- `toolChoice: "auto"` - 让 LLM 自主判断是否需要工具（默认）
- `toolChoice: "required"` - 确保 LLM 必须调用工具（如需要明确的结构化输出）
- `toolChoice: "none"` - 仅需要文本回复，不调用工具

### 3. LLM 响应处理
```typescript
const response = await llmProvider.oneTurnChat(model, request);

if (response.toolCalls) {
    // 处理工具调用
    for (const toolCall of response.toolCalls) {
        const result = await executeFunction(
            toolCall.function.name,
            toolCall.function.arguments
        );

        // 将工具响应添加到对话历史
        const toolMessage: ChatMessage = {
            role: "tool",
            toolCallId: toolCall.id,
            name: toolCall.function.name,
            response: result
        };
        messages.push(toolMessage);
    }
}
```

## 配置支持

### 输出格式配置
```typescript
export type OutputFormat = "json" | "text";
```

### 提供商配置
```typescript
export type OpenAIProviderConfig = {
    interface: "openai",
    api_keys: string[],
    models: string[],
    base_url?: string,
};

export type GenAIProviderConfig = {
    interface: "genai",
    api_keys: string[],
    models: string[],
};

export type ProviderConfig = OpenAIProviderConfig | GenAIProviderConfig;
```

## 架构优势

### 类型安全
- **强类型定义**: 所有工具调用参数都有严格的类型约束
- **联合类型**: 使用 TypeScript 联合类型确保类型正确性
- **编译时检查**: 参数类型错误在编译时就能发现

### 扩展性
- **模块化设计**: 工具定义与执行分离
- **标准化接口**: 统一的工具调用接口，支持不同类型的工具
- **提供商无关**: 工具调用逻辑与具体 LLM 提供商解耦
- **行为控制**: 通过 toolChoice 参数精确控制工具调用行为

### 一致性
- **统一请求格式**: 所有 LLM 提供商使用相同的请求接口
- **标准化响应**: 统一的响应格式，便于处理和调试
- **规范化参数**: JSON Schema 风格的参数定义

## 依赖关系

### 被使用者
- [[llm_client]] - 通过 OneTurnChatRequest 使用工具调用类型
- [[llm_client_manager]] - 传递工具调用请求到具体客户端
- [[llm_providers/openai_provider]] - 实现 OpenAI 的工具调用支持
- [[llm_providers/genai_provider]] - 实现 Google GenAI 的工具调用支持

### 相关模块
- [[message_handler]] - 可能在未来集成工具调用功能
- [[context_manager]] - 工具调用的消息历史管理

## 相关文件
- `src/llm_providers/types.ts` - 核心类型定义，包含 toolChoice 类型
- `src/llm_providers/openai_provider.ts` - OpenAI 工具调用实现，支持 tool_choice 参数
- `src/llm_providers/genai_provider.ts` - Google GenAI 工具调用实现，支持 FunctionCallingConfigMode
- `src/llm.ts` - LlmClient 工具调用接口
- `src/llm_client_manager.ts` - 工具调用请求管理