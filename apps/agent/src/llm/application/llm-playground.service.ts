import {
  type LlmPlaygroundChatRequest,
  type LlmPlaygroundChatResponse,
  type LlmPlaygroundToolListResponse,
  type LlmProviderListResponse,
} from "@kagami/shared/schemas/llm-chat";

export interface LlmPlaygroundService {
  listProviders(): Promise<LlmProviderListResponse>;
  listPlaygroundTools(): Promise<LlmPlaygroundToolListResponse>;
  chat(input: LlmPlaygroundChatRequest): Promise<LlmPlaygroundChatResponse>;
}
