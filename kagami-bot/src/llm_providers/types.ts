export type ChatMessagePart =
    | {
        type: "text",
        value: string,
    };

export interface ChatMessages {
    role: "system" | "user" | "assistant",
    content: ChatMessagePart[];
}

export interface LlmProvider {
    oneTurnChat(model: string, messages: ChatMessages[]): Promise<string>;
}

export interface OpenAIProviderConfig {
    interface: "openai",
    api_keys: string[],
    models: string[],
    base_url?: string,
}

export interface GenAIProviderConfig {
    interface: "genai",
    api_keys: string[],
    models: string[],
}

export type ProviderConfig = OpenAIProviderConfig | GenAIProviderConfig;
