import { randomUUID } from "node:crypto";
import { LLM_PROVIDER_IDS, type LlmProviderId } from "@kagami/llm";
import {
  type LlmChatRequestPayload,
  type LlmProviderOption,
  type LlmRequestUserContentPart,
} from "@kagami/llm-api/llm-chat";
import type { LlmUsageId } from "@kagami/kernel/contracts/llm";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { Config } from "@kagami/kernel/config/config.loader";
import { BizError } from "@kagami/kernel/errors/biz-error";
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
import { llmProviderUnavailableError } from "./retryable-error.js";

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
  providers: Partial<Record<LlmProviderId, LlmProvider>>;
  providerConfigs: ProviderConfigs;
  usages: Record<LlmUsageId, LlmUsageConfig>;
  /**
   * 每次 attempt 结束（成功/失败）产出的可落库观测事件。llm-client 只产出事实，
   * 由上层（agent 装配层）决定是否写入 DB / metric —— 从而使本包对 `@kagami/persistence`
   * 零依赖。调用方式为 fire-and-forget，client 内部 catch，绝不影响 LLM 调用结果。
   */
  recordObservation?: (observation: LlmChatCallObservation) => void | Promise<void>;
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

/**
 * 单次 attempt 的可落库观测事件。字段与 `LlmChatCallDao.recordSuccess/recordError`
 * 的入参一一对应，携带足以完整重放落库的信息（`seq` / native payload / native error /
 * configured + actual model 经 extension）。落库映射由 agent 侧订阅者完成。
 */
export type LlmChatCallSuccessObservation = {
  status: "success";
  provider: LlmProviderId;
  model: string;
  extension: Record<string, unknown>;
  requestId: string;
  seq: number;
  latencyMs: number;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  nativeRequestPayload: Record<string, unknown> | null;
  nativeResponsePayload: Record<string, unknown> | null;
};

export type LlmChatCallErrorObservation = {
  status: "failed";
  provider: LlmProviderId;
  model: string;
  extension: Record<string, unknown> | null;
  requestId: string;
  seq: number;
  latencyMs: number;
  request: Record<string, unknown>;
  response?: Record<string, unknown>;
  nativeRequestPayload: Record<string, unknown> | null;
  nativeResponsePayload: Record<string, unknown> | null;
  nativeError: Record<string, unknown> | null;
  error: unknown;
};

export type LlmChatCallObservation = LlmChatCallSuccessObservation | LlmChatCallErrorObservation;

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
              providers: options.providers,
              providerConfigs: options.providerConfigs,
              request,
              attempt,
              requestId,
              seq: (seq += 1),
              recordCall,
              recordObservation: options.recordObservation,
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
        recordObservation: options.recordObservation,
      });
    },
  };
}

async function executeChatAttempt({
  providers,
  providerConfigs,
  request,
  attempt,
  requestId,
  seq,
  recordCall,
  recordObservation,
}: {
  providers: Partial<Record<LlmProviderId, LlmProvider>>;
  providerConfigs: ProviderConfigs;
  request: LlmChatRequest;
  attempt: LlmUsageAttemptConfig;
  requestId: string;
  seq: number;
  recordCall: boolean;
  recordObservation?: (observation: LlmChatCallObservation) => void | Promise<void>;
}): Promise<LlmChatDirectResult> {
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
      throw llmProviderUnavailableError({ meta: { provider: attempt.provider } });
    }

    providerResult = await provider.chat(requestWithModel);
    response = providerResult.response;
    validateToolCalls(requestWithModel, response);
    const latencyMs = Date.now() - startedAt;

    if (recordCall) {
      emitObservation(recordObservation, {
        status: "success",
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
      });
    }

    return {
      response,
      nativeRequestPayload: providerResult.nativeRequestPayload ?? null,
      nativeResponsePayload: providerResult.nativeResponsePayload ?? null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const failureContext = getLlmProviderFailureContext(error);

    if (recordCall) {
      const actualModel =
        getActualModelFromResponse(response) ??
        getActualModelFromPayload(providerResult?.nativeResponsePayload) ??
        getActualModelFromPayload(failureContext?.nativeResponsePayload);
      emitObservation(recordObservation, {
        status: "failed",
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
      });
    }

    throw error;
  }
}

/**
 * fire-and-forget 发出观测事件：同步调用订阅者（与旧实现 `void dao.recordSuccess().catch()`
 * 的调用时机一致），只对其返回的 Promise 做 catch；订阅方的任何同步/异步失败都不会影响
 * LLM 调用结果。
 */
function emitObservation(
  recordObservation: ((observation: LlmChatCallObservation) => void | Promise<void>) | undefined,
  observation: LlmChatCallObservation,
): void {
  if (!recordObservation) {
    return;
  }

  const onFailure = (e: unknown): void => {
    llmClientLogger.warn("Failed to record LLM chat call observation", {
      event: "llm.record_observation_failed",
      status: observation.status,
      error: e instanceof Error ? e.message : String(e),
    });
  };

  try {
    const result = recordObservation(observation);
    if (result instanceof Promise) {
      result.catch(onFailure);
    }
  } catch (error) {
    onFailure(error);
  }
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
  // payload 显式标注为契约类型，把「落库 shape」钉死在 @kagami/llm-api/llm-chat 上：
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
