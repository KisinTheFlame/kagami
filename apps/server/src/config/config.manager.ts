import type { LlmProviderId } from "../llm/types.js";

export type NapcatBootConfig = {
  wsUrl: string;
  reconnectMs: number;
  requestTimeoutMs: number;
  listenGroupId: string;
};

export type BootConfig = {
  databaseUrl: string;
  port: number;
  napcat: NapcatBootConfig;
};

export type LlmProviderRuntimeConfig = {
  apiKey?: string;
  baseUrl: string;
  chatModel: string;
  timeoutMs: number;
};

export type OpenAiCodexRuntimeConfig = {
  authFilePath: string;
  baseUrl: string;
  chatModel: string;
  refreshLeewayMs: number;
  timeoutMs: number;
};

export type LlmRuntimeConfig = {
  activeProvider: LlmProviderId;
  timeoutMs: number;
  deepseek: LlmProviderRuntimeConfig;
  openai: LlmProviderRuntimeConfig;
  openaiCodex: OpenAiCodexRuntimeConfig;
};

export type TavilyConfig = {
  apiKey?: string;
};

export type BotProfileConfig = {
  botQQ: string;
};

export interface ConfigManager {
  getBootConfig(): Promise<BootConfig>;
  getLlmRuntimeConfig(): Promise<LlmRuntimeConfig>;
  getTavilyConfig(): Promise<TavilyConfig>;
  getBotProfileConfig(): Promise<BotProfileConfig>;
}
