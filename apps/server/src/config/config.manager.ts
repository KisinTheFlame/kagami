import type { LlmProviderId, LlmUsageId } from "../llm/types.js";

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
  models: string[];
  timeoutMs: number;
};

export type OpenAiCodexRuntimeConfig = {
  baseUrl: string;
  models: string[];
  timeoutMs: number;
};

export type CodexAuthRuntimeConfig = {
  enabled: boolean;
  publicBaseUrl: string;
  oauthRedirectPath: string;
  oauthStateTtlMs: number;
  refreshLeewayMs: number;
  timeoutMs: number;
};

export type ClaudeCodeAuthRuntimeConfig = {
  enabled: boolean;
  publicBaseUrl: string;
  oauthRedirectPath: string;
  oauthStateTtlMs: number;
  refreshLeewayMs: number;
  timeoutMs: number;
};

export type LlmUsageAttemptRuntimeConfig = {
  provider: LlmProviderId;
  model: string;
  times: number;
};

export type LlmUsageRuntimeConfig = {
  attempts: LlmUsageAttemptRuntimeConfig[];
};

export type LlmRuntimeConfig = {
  timeoutMs: number;
  deepseek: LlmProviderRuntimeConfig;
  openai: LlmProviderRuntimeConfig;
  openaiCodex: OpenAiCodexRuntimeConfig;
  claudeCode: LlmProviderRuntimeConfig;
  usages: Record<LlmUsageId, LlmUsageRuntimeConfig>;
};

export type RagEmbeddingProviderId = "google";

export type RagEmbeddingRuntimeConfig = {
  provider: RagEmbeddingProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  outputDimensionality: number;
};

export type RagRetrievalRuntimeConfig = {
  topK: number;
};

export type RagRuntimeConfig = {
  embedding: RagEmbeddingRuntimeConfig;
  retrieval: RagRetrievalRuntimeConfig;
};

export type TavilyConfig = {
  apiKey: string;
};

export type BotProfileConfig = {
  botQQ: string;
};

export interface ConfigManager {
  getBootConfig(): Promise<BootConfig>;
  getLlmRuntimeConfig(): Promise<LlmRuntimeConfig>;
  getCodexAuthRuntimeConfig(): Promise<CodexAuthRuntimeConfig>;
  getClaudeCodeAuthRuntimeConfig(): Promise<ClaudeCodeAuthRuntimeConfig>;
  getRagRuntimeConfig(): Promise<RagRuntimeConfig>;
  getTavilyConfig(): Promise<TavilyConfig>;
  getBotProfileConfig(): Promise<BotProfileConfig>;
}
