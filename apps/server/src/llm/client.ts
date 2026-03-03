import { randomUUID } from "node:crypto";
import { assertNever } from "@kagami/shared";
import { env } from "../env.js";
import { createDeepSeekProvider } from "./providers/deepseek-provider.js";
import { createOpenAiProvider } from "./providers/openai-provider.js";
import type { LlmProvider } from "./provider.js";
import type { LlmChatRequest, LlmChatResponse } from "./types.js";
import { logLlmError, logLlmRequest, logLlmResponse } from "./logger.js";

export interface LlmClient {
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
}

export function createLlmClient(provider: LlmProvider = createActiveProvider()): LlmClient {
  return {
    async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
      const requestId = randomUUID();
      const startedAt = Date.now();
      const model = request.model ?? getDefaultModel(provider.id);

      logLlmRequest({
        provider: provider.id,
        model,
        requestId,
        request,
      });

      try {
        const response = await provider.chat(request);

        logLlmResponse({
          provider: provider.id,
          model: response.model,
          requestId,
          latencyMs: Date.now() - startedAt,
          request,
          response,
        });

        return response;
      } catch (error) {
        logLlmError({
          provider: provider.id,
          model,
          requestId,
          latencyMs: Date.now() - startedAt,
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
