import { LlmClient, newLlmClient } from "./llm.js";
import { LlmResponse, OneTurnChatRequest } from "./llm_providers/types.js";
import { ConfigManager } from "./config_manager.js";
import { LlmCallLogRepository } from "./infra/llm_call_log_repository.js";

export class LlmClientManager {
    private clients: Record<string, LlmClient>;
    private configManager: ConfigManager;

    constructor(configManager: ConfigManager, llmCallLogRepository: LlmCallLogRepository) {
        this.configManager = configManager;
        this.clients = {};

        const llmConfig = configManager.getLlmConfig();
        // 为每个模型创建对应的 LlmClient
        for (const model of llmConfig.models) {
            const providerConfig = configManager.getProviderForModel(model);
            this.clients[model] = newLlmClient(providerConfig, model, llmCallLogRepository);
        }
    }

    private getLlmClient(model: string): LlmClient {
        if (!(model in this.clients)) {
            throw new Error(`未找到模型 "${model}" 对应的客户端`);
        }
        return this.clients[model];
    }

    async callWithFallback(request: OneTurnChatRequest): Promise<LlmResponse> {
        const configuredModels = this.configManager.getLlmConfig().models;
        for (const model of configuredModels) {
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

export const newLlmClientManager = (configManager: ConfigManager, llmCallLogRepository: LlmCallLogRepository) => {
    return new LlmClientManager(configManager, llmCallLogRepository);
};
