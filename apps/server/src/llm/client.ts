import { randomUUID } from "node:crypto";
import { assertNever } from "@kagami/shared";
import type { LlmChatCallDao } from "../dao/llm-chat-call.dao.js";
import { env } from "../env.js";
import { createDeepSeekProvider } from "./providers/deepseek-provider.js";
import { createOpenAiProvider } from "./providers/openai-provider.js";
import type { LlmProvider } from "./provider.js";
import type { LlmChatRequest, LlmChatResponse } from "./types.js";

export interface LlmClient {
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
}

type CreateLlmClientOptions = {
  llmChatCallDao: LlmChatCallDao;
  provider?: LlmProvider;
};

export function createLlmClient(options: CreateLlmClientOptions): LlmClient {
  const provider = options.provider ?? createActiveProvider();

  return {
    async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
      const requestId = randomUUID();
      const startedAt = Date.now();
      const model = request.model ?? getDefaultModel(provider.id);

      try {
        const response = await provider.chat(request);
        const latencyMs = Date.now() - startedAt;

        void options.llmChatCallDao
          .recordSuccess({
            provider: provider.id,
            model: response.model,
            requestId,
            latencyMs,
            request,
            response,
          })
          .catch(() => {});

        return response;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;

        void options.llmChatCallDao
          .recordError({
            provider: provider.id,
            model,
            requestId,
            latencyMs,
            request,
            error,
          })
          .catch(() => {});

        throw error;
      }
    },
  };
}

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
