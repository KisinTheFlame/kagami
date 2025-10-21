// JSON Schema 参数类型定义（联合类型）
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

// 工具定义
export type Tool = {
    name: string, // 函数名，必须是合法的标识符
    description: string, // 函数功能描述，供 LLM 理解何时调用
    parameters: ToolParam & { type: "object" },
};

// LLM 生成的工具调用请求
export type ToolCall = {
    id: string, // 工具调用的唯一标识符
    function: {
        name: string, // 要调用的函数名
        arguments: Record<string, unknown>, // 结构化参数对象
    },
};

export type ChatMessagePart = {
    type: "text",
    value: string,
};

// 扩展 ChatMessage 支持完整的工具调用流程（联合类型）
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
        toolCalls?: ToolCall[], // LLM 决定调用工具时存在
    }
    | {
        role: "tool",
        toolCallId: string, // 对应的工具调用 ID
        name?: string, // 工具名称
        response: Record<string, unknown>, // 响应体
    };

// 输出格式配置
export type OutputFormat = "json" | "text";

// oneTurnChat 方法请求参数
export type OneTurnChatRequest = {
    messages: ChatMessage[],
    tools: Tool[],
    outputFormat: OutputFormat,
    toolChoice?: "auto" | "required" | "none",
};

// LLM 响应解析结果
export type LlmResponse = {
    content?: string, // 文本回复内容
    toolCalls?: ToolCall[], // 工具调用请求（如果有）
};

// 扩展 LlmProvider 接口支持工具调用
export type LlmProvider = {
    /**
     * 执行一轮对话，支持工具调用
     * @param model 模型名称
     * @param request 对话请求参数
     * @returns LLM 的响应内容
     */
    oneTurnChat(model: string, request: OneTurnChatRequest): Promise<LlmResponse>,
};
