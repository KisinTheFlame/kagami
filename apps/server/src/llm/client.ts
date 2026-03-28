import { randomUUID } from "node:crypto";
import { type LlmProviderOption } from "@kagami/shared/schemas/llm-chat";
import type { LlmProviderId, LlmUsageId } from "../common/contracts/llm.js";
import type { Config } from "../config/config.loader.js";
import type { LlmChatCallDao } from "./dao/llm-chat-call.dao.js";
import { BizError } from "../common/errors/biz-error.js";
import {
  getLlmProviderFailureContext,
  type LlmProvider,
  type LlmProviderChatResult,
} from "./provider.js";
import type {
  LlmContentPart,
  LlmChatRequest,
  LlmChatResponsePayload,
  LlmToolChoice,
} from "./types.js";

type LlmProviderConfig = {
  apiKey?: string;
  baseUrl: string;
  models: string[];
  timeoutMs: number;
};

type OpenAiCodexConfig = Config["server"]["llm"]["providers"]["openaiCodex"] & {
  timeoutMs: Config["server"]["llm"]["timeoutMs"];
};

type LlmUsageAttemptConfig = Config["server"]["llm"]["usages"]["agent"]["attempts"][number];
type LlmUsageConfig = Config["server"]["llm"]["usages"]["agent"];
type ProviderConfigs = Record<LlmProviderId, LlmProviderConfig | OpenAiCodexConfig>;

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
  providerConfigs: ProviderConfigs;
  usages: Record<LlmUsageId, LlmUsageConfig>;
};

export type LlmChatOptions = {
  usage: LlmUsageId;
  recordCall?: boolean;
  loopRunId?: string;
  onSettled?: (observation: LlmChatObservation) => void | Promise<void>;
};

export type LlmChatDirectOptions = {
  providerId: LlmProviderId;
  model: string;
  recordCall?: boolean;
  loopRunId?: string;
  onSettled?: (observation: LlmChatObservation) => void | Promise<void>;
};

export type LlmListAvailableProvidersOptions = {
  usage: LlmUsageId;
};

export type LlmChatObservation = {
  requestId: string;
  loopRunId: string | null;
  provider: LlmProviderId;
  model: string;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  latencyMs: number;
  startedAt: Date;
  finishedAt: Date;
  status: "success" | "failed";
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
              loopRunId: chatOptions?.loopRunId,
              onSettled: chatOptions?.onSettled,
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
        loopRunId: chatOptions?.loopRunId,
        onSettled: chatOptions?.onSettled,
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
  loopRunId,
  onSettled,
}: {
  llmChatCallDao: LlmChatCallDao;
  providers: Partial<Record<LlmProviderId, LlmProvider>>;
  providerConfigs: ProviderConfigs;
  request: LlmChatRequest;
  attempt: LlmUsageAttemptConfig;
  requestId: string;
  seq: number;
  recordCall: boolean;
  loopRunId?: string;
  onSettled?: (observation: LlmChatObservation) => void | Promise<void>;
}): Promise<LlmChatResponsePayload> {
  requireConfiguredModel(providerConfigs, attempt.provider, attempt.model);
  const provider = providers[attempt.provider];
  const requestWithModel = {
    ...request,
    model: attempt.model,
  };
  const startedAt = Date.now();
  const startedAtDate = new Date();
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
          model: attempt.model,
          extension: buildExtension({
            actualModel: response.model,
          }),
          requestId,
          loopRunId,
          seq,
          latencyMs,
          request: toRecordableChatRequest(requestWithModel),
          response: toRecordableChatResponse(response),
          nativeRequestPayload: providerResult.nativeRequestPayload,
          nativeResponsePayload: providerResult.nativeResponsePayload,
        })
        .catch(() => {});
    }

    if (onSettled) {
      await onSettled({
        requestId,
        loopRunId: loopRunId ?? null,
        provider: provider.id,
        model: response.model,
        request: toRecordableChatRequest(requestWithModel),
        response: toRecordableChatResponse(response),
        error: null,
        latencyMs,
        startedAt: startedAtDate,
        finishedAt: new Date(),
        status: "success",
      });
    }

    return response;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const finishedAt = new Date();
    const failureContext = getLlmProviderFailureContext(error);
    const serializedError = serializeChatError(error);

    if (recordCall) {
      const actualModel =
        getActualModelFromResponse(response) ??
        getActualModelFromPayload(providerResult?.nativeResponsePayload) ??
        getActualModelFromPayload(failureContext?.nativeResponsePayload);
      void llmChatCallDao
        .recordError({
          provider: attempt.provider,
          model: attempt.model,
          extension:
            actualModel === undefined
              ? null
              : buildExtension({
                  actualModel,
                }),
          requestId,
          loopRunId,
          seq,
          latencyMs,
          request: toRecordableChatRequest(requestWithModel),
          ...(response ? { response: toRecordableChatResponse(response) } : {}),
          nativeRequestPayload:
            providerResult?.nativeRequestPayload ?? failureContext?.nativeRequestPayload ?? null,
          nativeResponsePayload:
            providerResult?.nativeResponsePayload ?? failureContext?.nativeResponsePayload ?? null,
          nativeError: failureContext?.nativeError ?? null,
          error,
        })
        .catch(() => {});
    }

    if (onSettled) {
      await onSettled({
        requestId,
        loopRunId: loopRunId ?? null,
        provider: attempt.provider,
        model: attempt.model,
        request: toRecordableChatRequest(requestWithModel),
        response: response ? toRecordableChatResponse(response) : null,
        error: serializedError,
        latencyMs,
        startedAt: startedAtDate,
        finishedAt,
        status: "failed",
      });
    }

    throw error;
  }
}

function serializeChatError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code:
        typeof (error as Error & { code?: unknown }).code === "string"
          ? (error as Error & { code?: string }).code
          : undefined,
    };
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? error : "Unknown error",
  };
}

function buildExtension(input: { actualModel: string }): Record<string, unknown> {
  return {
    metadata: {
      actualModel: input.actualModel,
    },
  };
}

function getActualModelFromResponse(response: LlmChatResponsePayload | null): string | undefined {
  if (!response) {
    return undefined;
  }

  return response.model;
}

function getActualModelFromPayload(
  payload: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!payload) {
    return undefined;
  }

  return typeof payload.model === "string" && payload.model.trim().length > 0
    ? payload.model
    : undefined;
}

async function listAvailableProviders(
  providers: Partial<Record<LlmProviderId, LlmProvider>>,
  providerConfigs: ProviderConfigs,
  usageConfig: LlmUsageConfig,
): Promise<LlmProviderOption[]> {
  const preferredProvider = usageConfig.attempts[0]?.provider;
  const availability = await Promise.all(
    (["deepseek", "openai", "openai-codex", "claude-code"] as const).map(async providerId => {
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

function toRecordableChatRequest(request: LlmChatRequest): Record<string, unknown> {
  return {
    ...(request.system ? { system: request.system } : {}),
    model: request.model,
    messages: request.messages.map(message => {
      if (message.role === "user") {
        return {
          role: "user",
          content:
            typeof message.content === "string"
              ? message.content
              : message.content.map(part => toRecordableContentPart(part)),
        };
      }

      if (message.role === "assistant") {
        return {
          role: "assistant",
          content: message.content,
          toolCalls: message.toolCalls,
        };
      }

      return {
        role: "tool",
        toolCallId: message.toolCallId,
        content: message.content,
      };
    }),
    tools: request.tools,
    toolChoice: request.toolChoice,
  };
}

function toRecordableContentPart(part: LlmContentPart): Record<string, unknown> {
  if (part.type === "text") {
    return part;
  }

  return {
    type: "image",
    mimeType: part.mimeType,
    filename: part.filename,
    sizeBytes: part.content.byteLength,
  };
}

function toRecordableChatResponse(response: LlmChatResponsePayload): Record<string, unknown> {
  return {
    provider: response.provider,
    model: response.model,
    message: response.message,
    ...(response.usage ? { usage: response.usage } : {}),
  };
}

function requireUsageConfig(
  usages: Record<LlmUsageId, LlmUsageConfig>,
  usage: LlmUsageId,
): LlmUsageConfig {
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
  providerConfigs: ProviderConfigs,
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
