import { type LlmProviderListResponse } from "@kagami/llm-api/llm-chat";

export interface LlmProviderService {
  listProviders(): Promise<LlmProviderListResponse>;
}
