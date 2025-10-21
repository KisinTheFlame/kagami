// OpenAI Provider 配置
export type OpenAIProviderConfig = {
    interface: "openai",
    api_keys: string[],
    models: string[],
    base_url?: string,
};

// GenAI Provider 配置
export type GenAIProviderConfig = {
    interface: "genai",
    api_keys: string[],
    models: string[],
};

// Provider 配置联合类型
export type ProviderConfig = OpenAIProviderConfig | GenAIProviderConfig;
