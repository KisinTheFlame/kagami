import { ProviderConfig, getProviderForModel } from "./config.js";
import { LlmProvider, ChatMessages } from "./llm_providers/types.js";
import { createLlmProvider } from "./llm_providers/factory.js";

export class LlmClient {
    private provider: LlmProvider;
    private model: string;

    constructor(providers: Record<string, ProviderConfig>, model: string) {
        const providerConfig = getProviderForModel(providers, model);
        this.provider = createLlmProvider(providerConfig);
        this.model = model;
    }

    async oneTurnChat(messages: ChatMessages[]): Promise<string> {
        return await this.provider.oneTurnChat(this.model, messages);
    }
}
