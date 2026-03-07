import type { LlmChatRequest, LlmChatResponsePayload, LlmProviderId } from "./types.js";

export interface LlmProvider {
  id: LlmProviderId;
  chat(request: LlmChatRequest): Promise<LlmChatResponsePayload>;
}
