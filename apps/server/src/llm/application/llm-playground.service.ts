import type {
  LlmPlaygroundChatRequest,
  LlmPlaygroundChatResponse,
  LlmPlaygroundToolListResponse,
  LlmProviderListResponse,
} from "@kagami/shared";

export interface LlmPlaygroundService {
  listProviders(): Promise<LlmProviderListResponse>;
  listPlaygroundTools(): Promise<LlmPlaygroundToolListResponse>;
  chat(input: LlmPlaygroundChatRequest): Promise<LlmPlaygroundChatResponse>;
}
