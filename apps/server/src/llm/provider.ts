import type { LlmChatRequest, LlmChatResponsePayload, LlmProviderId } from "./types.js";

export interface LlmProvider {
  id: LlmProviderId;
  isAvailable?(): Promise<boolean>;
  chat(request: LlmChatRequest): Promise<LlmChatResponsePayload>;
}
