import { randomUUID } from "node:crypto";
import { LLM_PROVIDER_IDS, type LlmProviderId } from "@kagami/llm";
import {
  type LlmChatRequestPayload,
  type LlmProviderOption,
  type LlmRequestUserContentPart,
} from "@kagami/shared/schemas/llm-chat";
import type { LlmUsageId } from "@kagami/server-core/common/contracts/llm";
import { AppLogger } from "@kagami/server-core/logger/logger";
import type { Config } from "@kagami/server-core/config/config.loader";
import type { MetricService } from "../metric/application/metric.service.js";
import type { LlmChatCallDao } from "@kagami/server-core/dao/llm-chat-call.dao";
import { BizError } from "@kagami/server-core/common/errors/biz-error";
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
import { imageContentToBase64 } from "@kagami/llm";

const llmClientLogger = new AppLogger({ source: "llm.client" });

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
  chatDirect(request: LlmChatRequest, options: LlmChatDirectOptions): Promise<LlmChatDirectResult>;
  listAvailableProviders(options: LlmListAvailableProvidersOptions): Promise<LlmProviderOption[]>;
}

type CreateLlmClientOptions = {
  llmChatCallDao: LlmChatCallDao;
  metricService: MetricService;
  providers: Partial<Record<LlmProviderId, LlmProvider>>;
  providerConfigs: ProviderConfigs;
  usages: Record<LlmUsageId, LlmUsageConfig>;
};

export type LlmChatOptions = {
  usage: LlmUsageId;
  recordCall?: boolean;
  onSettled?: (observation: LlmChatObservation) => void | Promise<void>;
};

export type LlmChatDirectOptions = {
  providerId: LlmProviderId;
  model: string;
  recordCall?: boolean;
  onSettled?: (observation: LlmChatObservation) => void | Promise<void>;
};

export type LlmListAvailableProvidersOptions = {
  usage: LlmUsageId;
};

export type LlmChatObservation = {
  requestId: string;
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

export type LlmChatDirectResult = {
  response: LlmChatResponsePayload;
  nativeRequestPayload: Record<string, unknown> | null;
  nativeResponsePayload: Record<string, unknown> | null;
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
            const result = await executeChatAttempt({
              llmChatCallDao: options.llmChatCallDao,
              metricService: options.metricService,
              providers: options.providers,
              providerConfigs: options.providerConfigs,
              request,
              usage,
              attempt,
              requestId,
              seq: (seq += 1),
              recordCall,
              onSettled: chatOptions?.onSettled,
            });
            return result.response;
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
    ): Promise<LlmChatDirectResult> {
      const providerId = requireProviderId(chatOptions?.providerId);
      const model = requireModel(chatOptions?.model);

      return await executeChatAttempt({
        llmChatCallDao: options.llmChatCallDao,
        metricService: options.metricService,
        providers: options.providers,
        providerConfigs: options.providerConfigs,
        request,
        usage: undefined,
        attempt: {
          provider: providerId,
          model,
          times: 1,
        },
        requestId: randomUUID(),
        seq: 1,
        recordCall: chatOptions?.recordCall ?? true,
        onSettled: chatOptions?.onSettled,
      });
    },
  };
}

async function executeChatAttempt({
  llmChatCallDao,
  metricService,
  providers,
  providerConfigs,
  request,
  usage,
  attempt,
  requestId,
  seq,
  recordCall,
  onSettled,
}: {
  llmChatCallDao: LlmChatCallDao;
  metricService: MetricService;
  providers: Partial<Record<LlmProviderId, LlmProvider>>;
  providerConfigs: ProviderConfigs;
  request: LlmChatRequest;
  usage: LlmUsageId | undefined;
  attempt: LlmUsageAttemptConfig;
  requestId: string;
  seq: number;
  recordCall: boolean;
  onSettled?: (observation: LlmChatObservation) => void | Promise<void>;
}): Promise<LlmChatDirectResult> {
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

    if (usage) {
      void recordLlmChatAttemptMetric({
        metricService,
        usage,
        provider: attempt.provider,
        model: attempt.model,
        status: "success",
      });
      void recordLlmChatLatencyMetric({
        metricService,
        usage,
        provider: attempt.provider,
        model: attempt.model,
        status: "success",
        latencyMs,
      });
      void recordLlmChatTotalTokensMetric({
        metricService,
        usage,
        provider: attempt.provider,
        model: attempt.model,
        totalTokens: response.usage?.totalTokens,
      });
    }

    if (recordCall) {
      void llmChatCallDao
        .recordSuccess({
          provider: provider.id,
          model: attempt.model,
          extension: buildExtension({
            actualModel: response.model,
          }),
          requestId,
          seq,
          latencyMs,
          request: toRecordableChatRequest(requestWithModel),
          response: toRecordableChatResponse(response),
          nativeRequestPayload: providerResult.nativeRequestPayload,
          nativeResponsePayload: providerResult.nativeResponsePayload,
        })
        .catch((e: unknown) => {
          llmClientLogger.warn("Failed to record LLM chat call success", {
            event: "llm.record_success_failed",
            error: e instanceof Error ? e.message : String(e),
          });
        });
    }

    if (onSettled) {
      await onSettled({
        requestId,
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

    return {
      response,
      nativeRequestPayload: providerResult.nativeRequestPayload ?? null,
      nativeResponsePayload: providerResult.nativeResponsePayload ?? null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const finishedAt = new Date();
    const failureContext = getLlmProviderFailureContext(error);
    const serializedError = serializeChatError(error);

    if (usage) {
      void recordLlmChatAttemptMetric({
        metricService,
        usage,
        provider: attempt.provider,
        model: attempt.model,
        status: "failed",
      });
      void recordLlmChatLatencyMetric({
        metricService,
        usage,
        provider: attempt.provider,
        model: attempt.model,
        status: "failed",
        latencyMs,
      });
    }

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
        .catch((e: unknown) => {
          llmClientLogger.warn("Failed to record LLM chat call error", {
            event: "llm.record_error_failed",
            error: e instanceof Error ? e.message : String(e),
          });
        });
    }

    if (onSettled) {
      await onSettled({
        requestId,
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
    LLM_PROVIDER_IDS.map(async providerId => {
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
  // payload 显式标注为共享契约类型，把「落库 shape」钉死在 @kagami/shared 上：
  // 后端序列化结构一旦漂移，这里立刻编译报错，前端 viewer 与之同源不再静默失配。
  const payload: LlmChatRequestPayload = {
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

  return payload;
}

function toRecordableContentPart(part: LlmContentPart): LlmRequestUserContentPart {
  if (part.type === "text") {
    return part;
  }

  return {
    type: "image",
    mimeType: part.mimeType,
    filename: part.filename,
    // content 一般是 base64 字符串；imageContentToBase64 兜底已被 JSON 毒过的历史图片
    // （{type:"Buffer",data:[]} 对象），避免对对象直接 Buffer.from 崩溃。解码回字节数仅用于记录。
    sizeBytes: Buffer.from(imageContentToBase64(part.content), "base64").byteLength,
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

function recordLlmChatAttemptMetric({
  metricService,
  usage,
  provider,
  model,
  status,
}: {
  metricService: MetricService;
  usage: LlmUsageId;
  provider: LlmProviderId;
  model: string;
  status: "success" | "failed";
}): Promise<void> {
  return metricService.record({
    metricName: "llm.chat.attempt",
    value: 1,
    tags: {
      usage,
      provider,
      model,
      status,
    },
  });
}

function recordLlmChatLatencyMetric({
  metricService,
  usage,
  provider,
  model,
  status,
  latencyMs,
}: {
  metricService: MetricService;
  usage: LlmUsageId;
  provider: LlmProviderId;
  model: string;
  status: "success" | "failed";
  latencyMs: number;
}): Promise<void> {
  return metricService.record({
    metricName: "llm.chat.latency_ms",
    value: latencyMs,
    tags: {
      usage,
      provider,
      model,
      status,
    },
  });
}

function recordLlmChatTotalTokensMetric({
  metricService,
  usage,
  provider,
  model,
  totalTokens,
}: {
  metricService: MetricService;
  usage: LlmUsageId;
  provider: LlmProviderId;
  model: string;
  totalTokens: number | undefined;
}): Promise<void> | undefined {
  if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens)) {
    return undefined;
  }

  return metricService.record({
    metricName: "llm.chat.total_tokens",
    value: totalTokens,
    tags: {
      usage,
      provider,
      model,
    },
  });
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

  // 注意：不在这里因为"工具不在 tools 列表里"而 throw 拒绝整条响应。
  // 调了未授权/未知的工具（典型：把子工具当顶层工具直接调而没走 invoke）属于
  // Agent 的正常失误，应当让响应正常通过，由工具执行层（ToolSet.execute 对未知
  // 工具返回 "Unknown tool" 的 tool_result）把反馈以 ToolResponse 追加到尾部，
  // 让 Agent 下一轮自我纠正。在此 throw 会让整轮 runOnce 崩溃、丢弃响应，Agent
  // 永远收不到反馈，也违背 KV 缓存友好的"只追加尾部"原则。
  //
  // 仅保留 toolChoice 强制单工具（required tool_name）的校验：那是 vision /
  // summarizer 这类一次性强制工具调用的场景，语义上不存在"让 Agent 改投"的回路。
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
