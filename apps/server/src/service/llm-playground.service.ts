import type {
  LlmPlaygroundChatRequest,
  LlmPlaygroundChatResponse,
  LlmProviderListResponse,
} from "@kagami/shared";

export interface LlmPlaygroundService {
  listProviders(): Promise<LlmProviderListResponse>;
  chat(input: LlmPlaygroundChatRequest): Promise<LlmPlaygroundChatResponse>;
}
