import { type LlmProviderListResponse } from "@kagami/llm-api/llm-chat";
import {
  type LlmPlaygroundChatRequest,
  type LlmPlaygroundChatResponse,
  type LlmPlaygroundToolListResponse,
} from "@kagami/agent-api/playground";

export interface LlmPlaygroundService {
  listProviders(): Promise<LlmProviderListResponse>;
  listPlaygroundTools(): Promise<LlmPlaygroundToolListResponse>;
  chat(input: LlmPlaygroundChatRequest): Promise<LlmPlaygroundChatResponse>;
}
