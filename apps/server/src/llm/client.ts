import { randomUUID } from "node:crypto";
import type { LlmProviderOption } from "@kagami/shared";
import type {
  LlmProviderRuntimeConfig,
  OpenAiCodexRuntimeConfig,
  LlmUsageAttemptRuntimeConfig,
  LlmUsageRuntimeConfig,
} from "../config/config.manager.js";
import type { LlmChatCallDao } from "../dao/llm-chat-call.dao.js";
import { BizError } from "../errors/biz-error.js";
import {
  getLlmProviderFailureContext,
  type LlmProvider,
  type LlmProviderChatResult,
} from "./provider.js";
import type {
  LlmChatRequest,
  LlmChatResponsePayload,
  LlmProviderId,
  LlmToolChoice,
  LlmUsageId,
} from "./types.js";

export interface LlmClient {
  chat(request: LlmChatRequest, options: LlmChatOptions): Promise<LlmChatResponsePayload>;
  chatDirect(
    request: LlmChatRequest,
    options: LlmChatDirectOptions,
  ): Promise<LlmChatResponsePayload>;
  listAvailableProviders(options: LlmListAvailableProvidersOptions): Promise<LlmProviderOption[]>;
}

type CreateLlmClientOptions = {
  llmChatCallDao: LlmChatCallDao;
  providers: Partial<Record<LlmProviderId, LlmProvider>>;
  providerConfigs: Record<LlmProviderId, LlmProviderRuntimeConfig | OpenAiCodexRuntimeConfig>;
  usages: Record<LlmUsageId, LlmUsageRuntimeConfig>;
};

export type LlmChatOptions = {
  usage: LlmUsageId;
  recordCall?: boolean;
};

export type LlmChatDirectOptions = {
  providerId: LlmProviderId;
  model: string;
  recordCall?: boolean;
};

export type LlmListAvailableProvidersOptions = {
  usage: LlmUsageId;
};

export function createLlmClient(options: CreateLlmClientOptions): LlmClient {
  return {
    async listAvailableProviders(
      listOptions: LlmListAvailableProvidersOptions,
    ): Promise<LlmProviderOption[]> {
      const usage = requireUsage(listOptions?.usage);
      return await listAvailableProviders(
        options.providers,
        options.providerConfigs,
        requireUsageConfig(options.usages, usage),
      );
    },
    async chat(
      request: LlmChatRequest,
      chatOptions: LlmChatOptions,
    ): Promise<LlmChatResponsePayload> {
      const usage = requireUsage(chatOptions?.usage);
      const requestId = randomUUID();
      const recordCall = chatOptions?.recordCall ?? true;
      const usageConfig = requireUsageConfig(options.usages, usage);

      let lastError: unknown;
      let seq = 0;
      for (const attempt of usageConfig.attempts) {
        for (let currentTry = 0; currentTry < attempt.times; currentTry += 1) {
          try {
            return await executeChatAttempt({
              llmChatCallDao: options.llmChatCallDao,
              providers: options.providers,
              providerConfigs: options.providerConfigs,
              request,
              attempt,
              requestId,
              seq: (seq += 1),
              recordCall,
            });
          } catch (error) {
            lastError = error;
          }
        }
      }

      throw lastError;
    },
    async chatDirect(
      request: LlmChatRequest,
      chatOptions: LlmChatDirectOptions,
    ): Promise<LlmChatResponsePayload> {
      const providerId = requireProviderId(chatOptions?.providerId);
      const model = requireModel(chatOptions?.model);

      return await executeChatAttempt({
        llmChatCallDao: options.llmChatCallDao,
        providers: options.providers,
        providerConfigs: options.providerConfigs,
        request,
        attempt: {
          provider: providerId,
          model,
          times: 1,
        },
        requestId: randomUUID(),
        seq: 1,
        recordCall: chatOptions?.recordCall ?? true,
      });
    },
  };
}

async function executeChatAttempt({
  llmChatCallDao,
  providers,
  providerConfigs,
  request,
  attempt,
  requestId,
  seq,
  recordCall,
}: {
  llmChatCallDao: LlmChatCallDao;
  providers: Partial<Record<LlmProviderId, LlmProvider>>;
  providerConfigs: Record<LlmProviderId, LlmProviderRuntimeConfig | OpenAiCodexRuntimeConfig>;
  request: LlmChatRequest;
  attempt: LlmUsageAttemptRuntimeConfig;
  requestId: string;
  seq: number;
  recordCall: boolean;
}): Promise<LlmChatResponsePayload> {
  requireConfiguredModel(providerConfigs, attempt.provider, attempt.model);
  const provider = providers[attempt.provider];
  const requestWithModel = {
    ...request,
    model: attempt.model,
  };
  const startedAt = Date.now();
  let providerResult: LlmProviderChatResult | null = null;
  let response: LlmChatResponsePayload | null = null;

  try {
    if (!provider) {
      throw new BizError({
        message: "所选 LLM provider 当前不可用",
        meta: {
          provider: attempt.provider,
        },
      });
    }

    providerResult = await provider.chat(requestWithModel);
    response = providerResult.response;
    validateToolCalls(requestWithModel, response);
    const latencyMs = Date.now() - startedAt;

    if (recordCall) {
      void llmChatCallDao
        .recordSuccess({
          provider: provider.id,
          model: response.model,
          requestId,
          seq,
          latencyMs,
          request: requestWithModel,
          response,
          nativeRequestPayload: providerResult.nativeRequestPayload,
          nativeResponsePayload: providerResult.nativeResponsePayload,
        })
        .catch(() => {});
    }

    return response;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const failureContext = getLlmProviderFailureContext(error);

    if (recordCall) {
      void llmChatCallDao
        .recordError({
          provider: attempt.provider,
          model: attempt.model,
          requestId,
          seq,
          latencyMs,
          request: requestWithModel,
          ...(response ? { response } : {}),
          nativeRequestPayload:
            providerResult?.nativeRequestPayload ?? failureContext?.nativeRequestPayload ?? null,
          nativeResponsePayload:
            providerResult?.nativeResponsePayload ?? failureContext?.nativeResponsePayload ?? null,
          nativeError: failureContext?.nativeError ?? null,
          error,
        })
        .catch(() => {});
    }

    throw error;
  }
}

async function listAvailableProviders(
  providers: Partial<Record<LlmProviderId, LlmProvider>>,
  providerConfigs: Record<LlmProviderId, LlmProviderRuntimeConfig | OpenAiCodexRuntimeConfig>,
  usageConfig: LlmUsageRuntimeConfig,
): Promise<LlmProviderOption[]> {
  const preferredProvider = usageConfig.attempts[0]?.provider;
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
    models: providerConfigs[providerId].models,
  }));
}

function requireUsage(usage: LlmUsageId | undefined): LlmUsageId {
  if (!usage) {
    throw new Error("LlmClient.chat and listAvailableProviders require an explicit usage");
  }

  return usage;
}

function requireUsageConfig(
  usages: Record<LlmUsageId, LlmUsageRuntimeConfig>,
  usage: LlmUsageId,
): LlmUsageRuntimeConfig {
  const usageConfig = usages[usage];
  if (!usageConfig) {
    throw new Error(`LlmClient usage is not configured: ${usage}`);
  }

  return usageConfig;
}

function requireProviderId(providerId: LlmProviderId | undefined): LlmProviderId {
  if (!providerId) {
    throw new Error("LlmClient.chatDirect requires providerId");
  }

  return providerId;
}

function requireModel(model: string | undefined): string {
  if (!model || model.trim().length === 0) {
    throw new Error("LlmClient.chatDirect requires model");
  }

  return model;
}

function requireConfiguredModel(
  providerConfigs: Record<LlmProviderId, LlmProviderRuntimeConfig | OpenAiCodexRuntimeConfig>,
  providerId: LlmProviderId,
  model: string,
): void {
  if (providerConfigs[providerId].models.includes(model)) {
    return;
  }

  throw new BizError({
    message: "所选 LLM 模型未在当前 provider 中配置",
    meta: {
      provider: providerId,
      model,
    },
  });
}

function validateToolCalls(request: LlmChatRequest, response: LlmChatResponsePayload): void {
  if (response.message.toolCalls.length === 0) {
    return;
  }

  const allowedToolNames = new Set(request.tools.map(tool => tool.name));
  const invalidToolNames = response.message.toolCalls
    .map(toolCall => toolCall.name)
    .filter(toolName => !allowedToolNames.has(toolName));

  if (invalidToolNames.length > 0) {
    throw new BizError({
      message: "LLM 返回了未授权的工具调用",
      meta: {
        provider: response.provider,
        model: response.model,
        invalidToolNames,
        allowedToolNames: [...allowedToolNames],
      },
    });
  }

  const requiredToolName = getRequiredToolName(request.toolChoice);
  if (!requiredToolName) {
    return;
  }

  const mismatchedToolNames = response.message.toolCalls
    .map(toolCall => toolCall.name)
    .filter(toolName => toolName !== requiredToolName);

  if (mismatchedToolNames.length > 0) {
    throw new BizError({
      message: "LLM 未按要求调用指定工具",
      meta: {
        provider: response.provider,
        model: response.model,
        requiredToolName,
        mismatchedToolNames,
      },
    });
  }
}

function getRequiredToolName(toolChoice: LlmToolChoice): string | null {
  if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "required") {
    return null;
  }

  return toolChoice.tool_name;
}
