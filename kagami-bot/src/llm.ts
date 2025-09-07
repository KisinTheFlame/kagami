import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LlmConfig } from "./config.js";
import { ApiKeyManager } from "./api_key_manager.js";

export class LlmClient {
    private baseURL: string;
    private apiKeyManager: ApiKeyManager;
    private model: string;

    constructor(config: LlmConfig) {
        this.baseURL = config.base_url;
        this.apiKeyManager = new ApiKeyManager(config.api_keys);
        this.model = config.model;
    }

    async oneTurnChat(messages: ChatCompletionMessageParam[]): Promise<string> {
        try {
            const apiKey = this.apiKeyManager.getRandomApiKey();
            const openai = new OpenAI({
                baseURL: this.baseURL,
                apiKey: apiKey,
            });

            const response = await openai.chat.completions.create({
                model: this.model,
                messages: messages,
                response_format: {
                    type: "json_object",
                },
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                console.error("OpenAI API 返回空内容");
                return "";  // 返回空字符串而不是抛异常
            }

            return content;
        } catch (error) {
            console.error(`LLM 请求失败: ${error instanceof Error ? error.message : String(error)}`);
            return "";  // 返回空字符串而不是抛异常，让上层处理日志记录
        }
    }
}
