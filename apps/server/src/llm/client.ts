import { randomUUID } from "node:crypto";
import type { LlmProviderOption } from "@kagami/shared";
import { assertNever } from "@kagami/shared";
import type {
  ConfigManager,
  LlmRuntimeConfig,
  LlmUsageAttemptRuntimeConfig,
} from "../config/config.manager.js";
import type { LlmChatCallDao } from "../dao/llm-chat-call.dao.js";
import { LlmProviderUnavailableError } from "./errors.js";
import { createDeepSeekProvider } from "./providers/deepseek-provider.js";
import { createOpenAiProvider } from "./providers/openai-provider.js";
import { createOpenAiCodexProvider } from "./providers/openai-codex-provider.js";
import type { LlmProvider } from "./provider.js";
import type { LlmChatRequest, LlmChatResponsePayload, LlmProviderId, LlmUsageId } from "./types.js";

export interface LlmClient {
  chat(request: LlmChatRequest, options?: LlmChatOptions): Promise<LlmChatResponsePayload>;
  listAvailableProviders(options?: { usage?: LlmUsageId }): Promise<LlmProviderOption[]>;
}

type CreateLlmClientOptions = {
  configManager: ConfigManager;
  llmChatCallDao: LlmChatCallDao;
  providers?: Partial<Record<LlmProviderId, LlmProvider>>;
};

export type LlmChatOptions = {
  providerId?: LlmProviderId;
  recordCall?: boolean;
  usage?: LlmUsageId;
};

export function createLlmClient(options: CreateLlmClientOptions): LlmClient {
  return {
    async listAvailableProviders(listOptions?: {
      usage?: LlmUsageId;
    }): Promise<LlmProviderOption[]> {
      const config = await options.configManager.getLlmRuntimeConfig();
      const providers = createProviderRegistry(config, options.providers);
      return await listAvailableProviders(config, providers, listOptions?.usage ?? "agent");
    },
    async chat(
      request: LlmChatRequest,
      chatOptions?: LlmChatOptions,
    ): Promise<LlmChatResponsePayload> {
      const config = await options.configManager.getLlmRuntimeConfig();
      const providers = createProviderRegistry(config, options.providers);
      const requestId = randomUUID();
      const usage = chatOptions?.usage ?? "agent";
      const recordCall = chatOptions?.recordCall ?? true;

      if (chatOptions?.providerId) {
        return await executeChatAttempt({
          llmChatCallDao: options.llmChatCallDao,
          providers,
          request,
          attempt: {
            provider: chatOptions.providerId,
            model: request.model ?? getDefaultModel(config, chatOptions.providerId),
            times: 1,
          },
          requestId,
          recordCall,
        });
      }

      let lastError: unknown;
      for (const attempt of config.usages[usage].attempts) {
        for (let currentTry = 0; currentTry < attempt.times; currentTry += 1) {
          try {
            return await executeChatAttempt({
              llmChatCallDao: options.llmChatCallDao,
              providers,
              request,
              attempt,
              requestId,
              recordCall,
            });
          } catch (error) {
            lastError = error;
          }
        }
      }

      throw lastError;
    },
  };
}

async function executeChatAttempt({
  llmChatCallDao,
  providers,
  request,
  attempt,
  requestId,
  recordCall,
}: {
  llmChatCallDao: LlmChatCallDao;
  providers: Partial<Record<LlmProviderId, LlmProvider>>;
  request: LlmChatRequest;
  attempt: LlmUsageAttemptRuntimeConfig;
  requestId: string;
  recordCall: boolean;
}): Promise<LlmChatResponsePayload> {
  const provider = providers[attempt.provider];
  const requestWithModel = {
    ...request,
    model: attempt.model,
  };
  const startedAt = Date.now();

  try {
    if (!provider) {
      throw new LlmProviderUnavailableError({ provider: attempt.provider });
    }

    const response = await provider.chat(requestWithModel);
    const latencyMs = Date.now() - startedAt;

    if (recordCall) {
      void llmChatCallDao
        .recordSuccess({
          provider: provider.id,
          model: response.model,
          requestId,
          latencyMs,
          request: requestWithModel,
          response,
        })
        .catch(() => {});
    }

    return response;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    if (recordCall) {
      void llmChatCallDao
        .recordError({
          provider: attempt.provider,
          model: attempt.model,
          requestId,
          latencyMs,
          request: requestWithModel,
          error,
        })
        .catch(() => {});
    }

    throw error;
  }
}

function createProviderRegistry(
  config: LlmRuntimeConfig,
  providerOverrides?: Partial<Record<LlmProviderId, LlmProvider>>,
): Partial<Record<LlmProviderId, LlmProvider>> {
  return {
    deepseek: providerOverrides?.deepseek ?? createRuntimeProvider("deepseek", config),
    openai: providerOverrides?.openai ?? createRuntimeProvider("openai", config),
    "openai-codex":
      providerOverrides?.["openai-codex"] ?? createRuntimeProvider("openai-codex", config),
  };
}

async function listAvailableProviders(
  config: LlmRuntimeConfig,
  providers: Partial<Record<LlmProviderId, LlmProvider>>,
  usage: LlmUsageId,
): Promise<LlmProviderOption[]> {
  const preferredProvider = config.usages[usage].attempts[0]?.provider;
  const availability = await Promise.all(
    (["deepseek", "openai", "openai-codex"] as const).map(async providerId => {
      const provider = providers[providerId];
      if (!provider) {
        return null;
      }

      const isAvailable = await provider.isAvailable?.();
      if (isAvailable === false) {
        return null;
      }

      return providerId;
    }),
  );

  const orderedIds = availability
    .filter(
      (providerId): providerId is (typeof availability)[number] & string => providerId !== null,
    )
    .sort((left, right) => {
      if (preferredProvider && left === preferredProvider) {
        return -1;
      }

      if (preferredProvider && right === preferredProvider) {
        return 1;
      }

      return left.localeCompare(right);
    });

  return orderedIds.map(providerId => ({
    id: providerId,
    defaultModel: getDefaultModel(config, providerId),
    isActive: providerId === preferredProvider,
  }));
}

function getDefaultModel(config: LlmRuntimeConfig, providerId: LlmProviderId): string {
  switch (providerId) {
    case "deepseek":
      return config.deepseek.chatModel;
    case "openai":
      return config.openai.chatModel;
    case "openai-codex":
      return config.openaiCodex.chatModel;
    default:
      return assertNever(providerId, "Unsupported provider");
  }
}

function createRuntimeProvider(
  providerId: LlmProviderId,
  config: LlmRuntimeConfig,
): LlmProvider | undefined {
  switch (providerId) {
    case "deepseek":
      return config.deepseek.apiKey
        ? createDeepSeekProvider({
            ...config.deepseek,
            apiKey: config.deepseek.apiKey,
          })
        : undefined;
    case "openai":
      return config.openai.apiKey
        ? createOpenAiProvider({
            ...config.openai,
            apiKey: config.openai.apiKey,
          })
        : undefined;
    case "openai-codex":
      return createOpenAiCodexProvider(config.openaiCodex);
    default:
      return assertNever(providerId, "Unsupported provider");
  }
}
