import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LlmConfig } from "./config.js";

export class LlmClient {
    private openai: OpenAI;
    private model: string;

    constructor(config: LlmConfig) {
        this.openai = new OpenAI({
            baseURL: config.base_url,
            apiKey: config.api_key,
        });
        this.model = config.model;
    }

    async oneTurnChat(messages: ChatCompletionMessageParam[]): Promise<string> {
        try {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: messages,
                response_format: {
                    type: "json_object",
                },
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error("OpenAI API 返回空内容");
            }

            return content;
        } catch (error) {
            throw new Error(`LLM 请求失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
