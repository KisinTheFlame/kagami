import { ProviderConfig, LlmProvider, LlmResponse, OneTurnChatRequest } from "./llm_providers/types.js";
import { createLlmProvider } from "./llm_providers/factory.js";
import { LlmCallLogRepository } from "./infra/llm_call_log_repository.js";

export class LlmClient {
    private provider: LlmProvider;
    private model: string;
    private llmCallLogRepository: LlmCallLogRepository;

    constructor(providerConfig: ProviderConfig, model: string, llmCallLogRepository: LlmCallLogRepository) {
        this.provider = createLlmProvider(providerConfig);
        this.model = model;
        this.llmCallLogRepository = llmCallLogRepository;
    }

    async oneTurnChat(request: OneTurnChatRequest): Promise<LlmResponse> {
        // 生成输入字符串用于记录（保持原有格式）
        const inputForLog = JSON.stringify(request.messages, null, 2); // TODO: 增加日志信息

        try {
            const llmResponse = await this.provider.oneTurnChat(this.model, request);
            void this.llmCallLogRepository.logLLMCall("success", inputForLog, llmResponse.content ?? ""); // TODO: 保存工具调用
            return llmResponse;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
            void this.llmCallLogRepository.logLLMCall("fail", inputForLog, `模型 ${this.model} 调用失败: ${errorMessage}`);
            throw error;
        }
    }
}

export const newLlmClient = (providerConfig: ProviderConfig, model: string, llmCallLogRepository: LlmCallLogRepository) => {
    return new LlmClient(providerConfig, model, llmCallLogRepository);
};
