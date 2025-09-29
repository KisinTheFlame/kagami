import { ProviderConfig, LlmProvider, LlmResponse, OneTurnChatRequest } from "./llm_providers/types.js";
import { createLlmProvider } from "./llm_providers/factory.js";
import { Database } from "./infra/db.js";

export class LlmClient {
    private provider: LlmProvider;
    private model: string;
    private database: Database;

    constructor(providerConfig: ProviderConfig, model: string, database: Database) {
        this.provider = createLlmProvider(providerConfig);
        this.model = model;
        this.database = database;
    }

    async oneTurnChat(request: OneTurnChatRequest): Promise<LlmResponse> {
        // 生成输入字符串用于记录（保持原有格式）
        const inputForLog = JSON.stringify(request.messages, null, 2); // TODO: 增加日志信息

        try {
            const llmResponse = await this.provider.oneTurnChat(this.model, request);
            void this.database.logLLMCall("success", inputForLog, JSON.stringify(llmResponse));
            return llmResponse;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
            void this.database.logLLMCall("fail", inputForLog, `模型 ${this.model} 调用失败: ${errorMessage}`);
            throw error;
        }
    }
}

export const newLlmClient = (providerConfig: ProviderConfig, model: string, database: Database) => {
    return new LlmClient(providerConfig, model, database);
};
