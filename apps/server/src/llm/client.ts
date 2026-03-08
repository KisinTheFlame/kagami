import { randomUUID } from "node:crypto";
import type { LlmProviderOption } from "@kagami/shared";
import { assertNever } from "@kagami/shared";
import type { LlmChatCallDao } from "../dao/llm-chat-call.dao.js";
import { env } from "../env.js";
import { LlmProviderUnavailableError } from "./errors.js";
import { createDeepSeekProvider } from "./providers/deepseek-provider.js";
import { createOpenAiProvider } from "./providers/openai-provider.js";
import type { LlmProvider } from "./provider.js";
import type { LlmChatRequest, LlmChatResponsePayload, LlmProviderId } from "./types.js";

export interface LlmClient {
  chat(request: LlmChatRequest, options?: LlmChatOptions): Promise<LlmChatResponsePayload>;
  listAvailableProviders(): LlmProviderOption[];
}

type CreateLlmClientOptions = {
  llmChatCallDao: LlmChatCallDao;
  providers?: Partial<Record<LlmProviderId, LlmProvider>>;
};

export type LlmChatOptions = {
  providerId?: LlmProviderId;
  recordCall?: boolean;
};

export function createLlmClient(options: CreateLlmClientOptions): LlmClient {
  const providers = createProviderRegistry(options.providers);
  const availableProviders = listAvailableProviders(providers);

  return {
    listAvailableProviders(): LlmProviderOption[] {
      return availableProviders;
    },
    async chat(
      request: LlmChatRequest,
      chatOptions?: LlmChatOptions,
    ): Promise<LlmChatResponsePayload> {
      const requestId = randomUUID();
      const startedAt = Date.now();
      const providerId = chatOptions?.providerId ?? env.LLM_ACTIVE_PROVIDER;
      const provider = providers[providerId];
      const recordCall = chatOptions?.recordCall ?? true;

      if (!provider) {
        throw new LlmProviderUnavailableError({ provider: providerId });
      }

      const model = request.model ?? getDefaultModel(providerId);

      try {
        const response = await provider.chat(request);
        const latencyMs = Date.now() - startedAt;

        if (recordCall) {
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
        }

        return response;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;

        if (recordCall) {
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
        }

        throw error;
      }
    },
  };
}

function createProviderRegistry(
  providerOverrides?: Partial<Record<LlmProviderId, LlmProvider>>,
): Partial<Record<LlmProviderId, LlmProvider>> {
  return {
    deepseek:
      providerOverrides?.deepseek ?? (env.DEEPSEEK_API_KEY ? createDeepSeekProvider() : undefined),
    openai: providerOverrides?.openai ?? (env.OPENAI_API_KEY ? createOpenAiProvider() : undefined),
  };
}

function listAvailableProviders(
  providers: Partial<Record<LlmProviderId, LlmProvider>>,
): LlmProviderOption[] {
  const orderedIds = (["deepseek", "openai"] as const)
    .filter(providerId => providers[providerId] !== undefined)
    .sort((left, right) => {
      if (left === env.LLM_ACTIVE_PROVIDER) {
        return -1;
      }

      if (right === env.LLM_ACTIVE_PROVIDER) {
        return 1;
      }

      return left.localeCompare(right);
    });

  return orderedIds.map(providerId => ({
    id: providerId,
    defaultModel: getDefaultModel(providerId),
    isActive: providerId === env.LLM_ACTIVE_PROVIDER,
  }));
}

function getDefaultModel(providerId: LlmProviderId): string {
  switch (providerId) {
    case "deepseek":
      return env.DEEPSEEK_CHAT_MODEL;
    case "openai":
      return env.OPENAI_CHAT_MODEL;
    default:
      return assertNever(providerId, "Unsupported provider");
  }
}
