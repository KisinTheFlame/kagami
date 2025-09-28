import { LlmClient } from "./llm.js";
import { LlmResponse, OneTurnChatRequest } from "./llm_providers/types.js";
import { loadConfig, getProviderForModel } from "./config.js";

class LlmClientManager {
    private clients: Record<string, LlmClient>;
    private configuredModels: string[];

    constructor() {
        const config = loadConfig();

        this.clients = {};
        this.configuredModels = [...config.llm.models];

        // 为每个模型创建对应的 LlmClient
        for (const model of this.configuredModels) {
            const providerConfig = getProviderForModel(config.llm_providers, model);
            this.clients[model] = new LlmClient(providerConfig, model);
        }
    }

    private getLlmClient(model: string): LlmClient {
        if (!(model in this.clients)) {
            throw new Error(`未找到模型 "${model}" 对应的客户端`);
        }
        return this.clients[model];
    }

    async callWithFallback(request: OneTurnChatRequest): Promise<LlmResponse> {
        for (const model of this.configuredModels) {
            try {
                const client = this.getLlmClient(model);
                return await client.oneTurnChat(request);
            } catch (error) {
                console.warn(`模型 ${model} 调用失败:`, error);
                // 继续尝试下一个模型
            }
        }

        throw new Error("所有配置的模型都调用失败");
    }
}

export const llmClientManager = new LlmClientManager();
