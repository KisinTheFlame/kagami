import { randomUUID } from "node:crypto";
import { assertNever } from "@kagami/shared";
import { env } from "../env.js";
import { createDeepSeekProvider } from "./providers/deepseek-provider.js";
import { createOpenAiProvider } from "./providers/openai-provider.js";
import type { LlmProvider } from "./provider.js";
import type { LlmChatRequest, LlmChatResponse } from "./types.js";
import { recordLlmChatCallError, recordLlmChatCallSuccess } from "./chat-call-recorder.js";

export interface LlmClient {
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
}

export function createLlmClient(provider: LlmProvider = createActiveProvider()): LlmClient {
  return {
    async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
      const requestId = randomUUID();
      const startedAt = Date.now();
      const model = request.model ?? getDefaultModel(provider.id);

      try {
        const response = await provider.chat(request);
        const latencyMs = Date.now() - startedAt;

        recordLlmChatCallSuccess({
          provider: provider.id,
          model: response.model,
          requestId,
          latencyMs,
          request,
          response,
        });

        return response;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;

        recordLlmChatCallError({
          provider: provider.id,
          model,
          requestId,
          latencyMs,
          request,
          error,
        });

        throw error;
      }
    },
  };
}

export const llmClient = createLlmClient();

function createActiveProvider(): LlmProvider {
  switch (env.LLM_ACTIVE_PROVIDER) {
    case "deepseek":
      return createDeepSeekProvider();
    case "openai":
      return createOpenAiProvider();
    default:
      return assertNever(env.LLM_ACTIVE_PROVIDER, "Unsupported provider");
  }
}

function getDefaultModel(providerId: LlmProvider["id"]): string {
  switch (providerId) {
    case "deepseek":
      return env.DEEPSEEK_CHAT_MODEL;
    case "openai":
      return env.OPENAI_CHAT_MODEL;
    default:
      return assertNever(providerId, "Unsupported provider");
  }
}
