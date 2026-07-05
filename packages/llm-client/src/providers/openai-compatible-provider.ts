import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import {
  attachLlmProviderFailureContext,
  toSerializableLlmNativeRecord,
  toSerializableLlmNativeRecordOrNull,
  type LlmProvider,
} from "../provider.js";
import { llmUpstreamCallFailedError } from "../retryable-error.js";
import type { LlmChatRequest } from "../types.js";
import { toLlmChatResponsePayload, toOpenAiChatRequest } from "../mappers/openai-chat-mapper.js";

/**
 * OpenAI 兼容（/chat/completions 协议）provider 的共享实现。
 *
 * deepseek 与 openai 两个 provider 除 id / 报错措辞外逐行相同，此前是两份平行拷贝，
 * 改一处易漏另一处（例如 #236 的 native error 保留 cause 链就要同步两份）。收敛到
 * 这一个 factory，二者退化为薄壳。
 *
 * 报错统一走 `llmUpstreamCallFailedError` 工厂：它盖 meta.retryable 标记供
 * isRetryableLlmFailure 判定退避重试，message 保持原文只为 wire / 日志字节稳定（见 #435）。
 */
export function createOpenAiCompatibleProvider({
  id,
  displayLabel,
  apiKey,
  baseUrl,
  timeoutMs,
}: {
  /** provider 标识，进 response payload 与错误 meta。 */
  id: "deepseek" | "openai";
  /** 报错文案里的可读名（如 "DeepSeek" / "OpenAI"）。 */
  displayLabel: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}): LlmProvider {
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    timeout: timeoutMs,
  });

  return {
    id,
    async chat(request: LlmChatRequest) {
      const model = requireRequestModel(request, displayLabel);
      const payload = toOpenAiChatRequest({ model, request });
      let completion: ChatCompletion | null = null;

      try {
        completion = await client.chat.completions.create(payload, {
          timeout: timeoutMs,
        });
      } catch (error) {
        throw attachLlmProviderFailureContext(
          llmUpstreamCallFailedError({ meta: { provider: id }, cause: error }),
          {
            nativeRequestPayload: toSerializableLlmNativeRecord(payload),
            nativeError: toSerializableLlmNativeRecord(error),
          },
        );
      }

      if (!completion?.choices[0]?.message) {
        throw attachLlmProviderFailureContext(
          llmUpstreamCallFailedError({ meta: { provider: id, reason: "EMPTY_CHOICES" } }),
          {
            nativeRequestPayload: toSerializableLlmNativeRecord(payload),
            nativeResponsePayload: toSerializableLlmNativeRecordOrNull(completion),
          },
        );
      }

      return {
        response: toLlmChatResponsePayload(completion, id),
        nativeRequestPayload: toSerializableLlmNativeRecord(payload),
        nativeResponsePayload: toSerializableLlmNativeRecord(completion),
      };
    },
  };
}

function requireRequestModel(request: LlmChatRequest, displayLabel: string): string {
  if (!request.model) {
    throw new Error(`${displayLabel} provider requires an explicit model`);
  }

  return request.model;
}
