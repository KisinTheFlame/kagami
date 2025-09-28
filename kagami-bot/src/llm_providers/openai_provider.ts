import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LlmProvider, ChatMessages, OpenAIProviderConfig } from "./types.js";
import { ApiKeyManager } from "../api_key_manager.js";

export class OpenAIProvider implements LlmProvider {
    private baseURL: string;
    private apiKeyManager: ApiKeyManager;

    constructor(config: OpenAIProviderConfig) {
        this.baseURL = config.base_url ?? "https://api.openai.com/v1";
        this.apiKeyManager = new ApiKeyManager(config.api_keys);
    }

    async oneTurnChat(model: string, messages: ChatMessages[]): Promise<string> {
        const apiKey = this.apiKeyManager.getRandomApiKey();
        const openai = new OpenAI({
            baseURL: this.baseURL,
            apiKey: apiKey,
        });

        const openaiMessages = this.convertMessages(messages);

        const response = await openai.chat.completions.create({
            model: model,
            messages: openaiMessages,
            response_format: {
                type: "json_object",
            },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error("OpenAI API 返回空内容");
        }

        return content;
    }

    private convertMessages(messages: ChatMessages[]): ChatCompletionMessageParam[] {
        return messages.map(msg => ({
            role: msg.role,
            content: msg.content.map(c => c.value).join(""),
        } satisfies ChatCompletionMessageParam));
    }
}
