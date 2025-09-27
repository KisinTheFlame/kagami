import { ProviderConfig, LlmProvider, ChatMessages } from "./llm_providers/types.js";
import { createLlmProvider } from "./llm_providers/factory.js";
import { logger } from "./middleware/logger.js";

export class LlmClient {
    private provider: LlmProvider;
    private model: string;

    constructor(providerConfig: ProviderConfig, model: string) {
        this.provider = createLlmProvider(providerConfig);
        this.model = model;
    }

    async oneTurnChat(messages: ChatMessages[]): Promise<string> {
        let status: "success" | "fail" = "fail";
        let llmResponse = "";

        // 生成输入字符串用于记录（保持原有格式）
        const inputForLog = JSON.stringify(messages, null, 2);

        try {
            llmResponse = await this.provider.oneTurnChat(this.model, messages);

            // 如果LLM返回空字符串，说明调用失败
            if (llmResponse === "") {
                status = "fail";
                void logger.logLLMCall(status, inputForLog, "LLM调用失败");
                throw new Error("LLM调用失败");
            }

            status = "success";
            void logger.logLLMCall(status, inputForLog, llmResponse);
            return llmResponse;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
            void logger.logLLMCall("fail", inputForLog, `模型 ${this.model} 调用失败: ${errorMessage}`);
            throw error;
        }
    }
}
