import type { LlmChatRequest, LlmChatResponse, LlmProviderId } from "./types.js";

export interface LlmProvider {
  id: LlmProviderId;
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
}
