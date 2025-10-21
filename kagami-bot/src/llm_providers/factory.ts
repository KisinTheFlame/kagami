import type { LlmProvider } from "kagami-types/domain/llm";
import type { ProviderConfig } from "kagami-types/domain/provider_config";
import { OpenAIProvider } from "./openai_provider.js";
import { GenAIProvider } from "./genai_provider.js";

export function createLlmProvider(config: ProviderConfig): LlmProvider {
    switch (config.interface) {
        case "openai":
            return new OpenAIProvider(config);
        case "genai":
            return new GenAIProvider(config);
        default:
            // 这个分支在 TypeScript 类型系统中不应该到达
            throw new Error("不支持的接口类型");
    }
}
