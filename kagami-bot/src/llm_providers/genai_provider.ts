import {
    Content,
    GoogleGenAI,
    Part,
    Tool as GenAITool,
    FunctionDeclaration,
    Schema,
    Type,
    GenerateContentParameters,
    FunctionCallingConfigMode,
    GenerateContentConfig,
} from "@google/genai";
import type {
    LlmProvider,
    ChatMessage,
    ChatMessagePart,
    Tool,
    LlmResponse,
    ToolParam,
    ToolCall,
    OneTurnChatRequest,
} from "kagami-types/domain/llm";
import type { GenAIProviderConfig } from "kagami-types/domain/provider_config";
import { ApiKeyManager } from "../api_key_manager.js";

const toolCallModeMapping: Record<string, FunctionCallingConfigMode> = {
    auto: FunctionCallingConfigMode.AUTO,
    required: FunctionCallingConfigMode.ANY,
    none: FunctionCallingConfigMode.NONE,
};

export class GenAIProvider implements LlmProvider {
    private apiKeyManager: ApiKeyManager;

    constructor(config: GenAIProviderConfig) {
        this.apiKeyManager = new ApiKeyManager(config.api_keys);
    }

    async oneTurnChat(model: string, request: OneTurnChatRequest): Promise<LlmResponse> {
        const { messages, tools, outputFormat, toolChoice } = request;

        const apiKey = this.apiKeyManager.getRandomApiKey();
        const ai = new GoogleGenAI({ apiKey });

        const { contents, systemInstruction } = this.convertMessages(messages);
        const genaiTools = this.convertTools(tools);

        try {
            const generateContentConfig: GenerateContentConfig = {
                responseMimeType: {
                    json: "application/json",
                    text: "text/plain",
                }[outputFormat],
                systemInstruction,
                tools: genaiTools,
            };

            if (toolChoice && genaiTools.length > 0) {
                generateContentConfig.toolConfig = {
                    functionCallingConfig: {
                        mode: toolCallModeMapping[toolChoice],
                    },
                };
            }

            const requestConfig: GenerateContentParameters = {
                model,
                contents,
                config: generateContentConfig,
            };

            const response = await ai.models.generateContent(requestConfig);

            const result: LlmResponse = {
                content: response.text,
            };

            // 处理工具调用
            if (response.functionCalls && response.functionCalls.length > 0) {
                result.toolCalls = response.functionCalls.map(
                    functionCall => ({
                        id: functionCall.id ?? "", // TODO: id 可能为空。为空时自己随机生成一个
                        function: {
                            name: functionCall.name ?? "unknown",
                            arguments: functionCall.args ?? {},
                        },
                    } satisfies ToolCall),
                );
            }

            return result;
        } catch (error) {
            throw new Error(`GenAI API 调用失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private convertTools(tools: Tool[]): GenAITool[] {
        return [
            {
                functionDeclarations: tools.map(
                    tool =>
                        ({
                            name: tool.name,
                            description: tool.description,
                            parameters: this.convertToolParameters(tool.parameters),
                        }) satisfies FunctionDeclaration,
                ),
            },
        ];
    }

    private convertToolParameters(param: ToolParam): Schema {
        const typeMapping: Record<string, Type> = {
            string: Type.STRING,
            number: Type.NUMBER,
            integer: Type.INTEGER,
            boolean: Type.BOOLEAN,
            object: Type.OBJECT,
            array: Type.ARRAY,
        };
        const result: Schema = {
            type: typeMapping[param.type] ?? Type.STRING, // 默认使用 STRING
            description: param.description,
        };

        switch (param.type) {
            case "object":
                result.properties = {};
                for (const [key, value] of Object.entries(param.properties)) {
                    result.properties[key] = this.convertToolParameters(value);
                }
                if (param.required) {
                    result.required = param.required;
                }
                break;
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

    private convertMessages(messages: ChatMessage[]) {
        const contents: Content[] = [];
        const systemInstruction: Part[] = [];

        for (const msg of messages) {
            if (msg.role === "system") {
                const parts = this.convert(msg.content);
                systemInstruction.push(...parts);
            } else if (msg.role === "user") {
                const parts = this.convert(msg.content);
                contents.push({
                    role: "user",
                    parts,
                });
            } else if (msg.role === "assistant") {
                const parts = this.convert(msg.content);
                const content: Content = {
                    role: "model",
                    parts,
                };

                // 处理工具调用
                if (msg.toolCalls) {
                    // GenAI 需要在 parts 中添加 functionCall
                    for (const toolCall of msg.toolCalls) {
                        content.parts ??= [];
                        content.parts.push({
                            functionCall: {
                                name: toolCall.function.name,
                                args: toolCall.function.arguments,
                            },
                        });
                    }
                }

                contents.push(content);
            } else {
                // GenAI 处理工具响应 (msg.role === "tool")
                contents.push({
                    role: "user",
                    parts: [
                        {
                            functionResponse: {
                                name: msg.name ?? "unknown",
                                response: msg.response,
                            },
                        },
                    ],
                });
            }
        }

        return {
            contents,
            systemInstruction,
        };
    }

    private convert(content: ChatMessagePart[]): Part[] {
        return content.map(part => this.convertPart(part));
    }

    private convertPart(part: ChatMessagePart): Part {
        return { text: part.value };
    }
}
