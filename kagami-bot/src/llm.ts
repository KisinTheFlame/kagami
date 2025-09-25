import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ProviderConfig, getProviderForModel } from "./config.js";
import { ApiKeyManager } from "./api_key_manager.js";

export class LlmClient {
    private baseURL: string;
    private apiKeyManager: ApiKeyManager;
    private model: string;

    constructor(providers: Record<string, ProviderConfig>, model: string) {
        const providerConfig = getProviderForModel(providers, model);
        this.baseURL = providerConfig.base_url;
        this.apiKeyManager = new ApiKeyManager(providerConfig.api_keys);
        this.model = model;
    }

    async oneTurnChat(messages: ChatCompletionMessageParam[]): Promise<string> {
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
            throw new Error("OpenAI API 返回空内容");
        }

        return content;
    }
}
