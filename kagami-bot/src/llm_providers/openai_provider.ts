import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
    LlmProvider,
    ChatMessage,
    OpenAIProviderConfig,
    Tool,
    LlmResponse,
    ToolParam,
    ToolCall,
    OneTurnChatRequest,
} from "./types.js";
import { ApiKeyManager } from "../api_key_manager.js";
import { z } from "zod";
import { ChatCompletionFunctionTool, FunctionParameters } from "openai/resources.js";

export class OpenAIProvider implements LlmProvider {
    private baseURL: string;
    private apiKeyManager: ApiKeyManager;

    constructor(config: OpenAIProviderConfig) {
        this.baseURL = config.base_url ?? "https://api.openai.com/v1";
        this.apiKeyManager = new ApiKeyManager(config.api_keys);
    }

    async oneTurnChat(model: string, request: OneTurnChatRequest): Promise<LlmResponse> {
        const { messages, tools, outputFormat } = request;

        const apiKey = this.apiKeyManager.getRandomApiKey();
        const openai = new OpenAI({
            baseURL: this.baseURL,
            apiKey: apiKey,
        });

        const openaiMessages = this.convertMessages(messages);
        const openaiTools = this.convertTools(tools);

        const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
            model: model,
            messages: openaiMessages,
            response_format: {
                type: (
                    {
                        json: "json_object",
                        text: "text",
                    } satisfies Record<string, "json_object" | "text">
                )[outputFormat],
            },
        };

        if (openaiTools.length > 0) {
            requestParams.tools = openaiTools;
        }

        const response = await openai.chat.completions.create(requestParams);

        const message = response.choices[0]?.message;

        const result: LlmResponse = {
            content: message.content ?? undefined,
        };

        // 处理工具调用
        if (message.tool_calls) {
            result.toolCalls = message.tool_calls
                .filter(toolCall => toolCall.type === "function")
                .map(
                    toolCall =>
                        ({
                            id: toolCall.id,
                            function: {
                                name: toolCall.function.name,
                                arguments: z
                                    .record(z.string(), z.unknown())
                                    .parse(JSON.parse(toolCall.function.arguments)),
                            },
                        }) satisfies ToolCall,
                );
        }

        return result;
    }

    private convertTools(tools: Tool[]): ChatCompletionFunctionTool[] {
        return tools.map(
            tool =>
                ({
                    type: "function",
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: this.convertToolParameters(tool.parameters),
                    },
                }) satisfies ChatCompletionFunctionTool,
        );
    }

    private convertToolParameters(param: ToolParam): FunctionParameters {
        const result: FunctionParameters = {
            type: param.type,
            description: param.description,
        };

        switch (param.type) {
            case "object": {
                const properties = {} as Record<string, FunctionParameters>;
                for (const [key, value] of Object.entries(param.properties)) {
                    properties[key] = this.convertToolParameters(value);
                }
                result.properties = properties;
                if (param.required) {
                    result.required = param.required;
                }
                break;
            }
            case "array":
                result.items = this.convertToolParameters(param.items);
                break;
            case "string":
                if (param.enum) {
                    result.enum = param.enum;
                }
                break;
            case "number":
            case "integer":
                if (param.enum) {
                    result.enum = param.enum.map(item => String(item));
                }
                break;
            default:
                break;
        }

        return result;
    }

    private convertMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
        return messages.map(msg => {
            if (msg.role === "assistant" && msg.toolCalls) {
                return {
                    role: "assistant",
                    content: msg.content.map(c => c.value).join(""),
                    tool_calls: msg.toolCalls.map(toolCall => ({
                        id: toolCall.id,
                        type: "function" as const,
                        function: {
                            name: toolCall.function.name,
                            arguments: JSON.stringify(toolCall.function.arguments),
                        },
                    })),
                } satisfies ChatCompletionMessageParam;
            } else if (msg.role === "tool") {
                return {
                    role: "tool",
                    tool_call_id: msg.toolCallId,
                    content: JSON.stringify(msg.response),
                } satisfies ChatCompletionMessageParam;
            } else {
                return {
                    role: msg.role,
                    content: msg.content.map(c => c.value).join(""),
                } satisfies ChatCompletionMessageParam;
            }
        });
    }
}
