import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { BizError } from "../../common/errors/biz-error.js";
import type { Config } from "../../config/config.loader.js";
import {
  attachLlmProviderFailureContext,
  toSerializableLlmNativeRecord,
  toSerializableLlmNativeRecordOrNull,
  type LlmProvider,
} from "../provider.js";
import type { LlmChatRequest } from "../types.js";
import { toLlmChatResponsePayload, toOpenAiChatRequest } from "../mappers/openai-chat-mapper.js";

type LlmProviderConfig = Config["server"]["llm"]["providers"]["deepseek"] & {
  timeoutMs: Config["server"]["llm"]["timeoutMs"];
};

export function createDeepSeekProvider(
  config: LlmProviderConfig & { apiKey: string },
): LlmProvider {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
  });

  return {
    id: "deepseek",
    async chat(request: LlmChatRequest) {
      const model = requireRequestModel(request);
      const payload = toOpenAiChatRequest({ model, request });
      let completion: ChatCompletion | null = null;

      try {
        completion = await client.chat.completions.create(payload, {
          timeout: config.timeoutMs,
        });
      } catch (error) {
        throw attachLlmProviderFailureContext(
          new BizError({
            message: "LLM 上游服务调用失败",
            meta: {
              provider: "deepseek",
            },
            cause: error,
          }),
          {
            nativeRequestPayload: toSerializableLlmNativeRecord(payload),
            nativeError: toSerializableLlmNativeRecord(error),
          },
        );
      }

      if (!completion?.choices[0]?.message) {
        throw attachLlmProviderFailureContext(
          new BizError({
            message: "LLM 上游服务调用失败",
            meta: {
              provider: "deepseek",
              reason: "EMPTY_CHOICES",
            },
          }),
          {
            nativeRequestPayload: toSerializableLlmNativeRecord(payload),
            nativeResponsePayload: toSerializableLlmNativeRecordOrNull(completion),
          },
        );
      }

      return {
        response: toLlmChatResponsePayload(completion, "deepseek"),
        nativeRequestPayload: toSerializableLlmNativeRecord(payload),
        nativeResponsePayload: toSerializableLlmNativeRecord(completion),
      };
    },
  };
}

function requireRequestModel(request: LlmChatRequest): string {
  if (!request.model) {
    throw new Error("DeepSeek provider requires an explicit model");
  }

  return request.model;
}
