import type {
  LlmPlaygroundChatRequest,
  LlmPlaygroundChatResponse,
  LlmProviderListResponse,
} from "@kagami/shared";

export interface LlmPlaygroundService {
  listProviders(): LlmProviderListResponse;
  chat(input: LlmPlaygroundChatRequest): Promise<LlmPlaygroundChatResponse>;
}
