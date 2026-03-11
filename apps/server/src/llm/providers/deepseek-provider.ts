import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { LlmProvider } from "../provider.js";
import type { LlmChatRequest } from "../types.js";
import type { LlmProviderRuntimeConfig } from "../../config/config.manager.js";
import { LlmProviderResponseError, LlmProviderUpstreamError } from "../errors.js";
import { toLlmChatResponsePayload, toOpenAiChatRequest } from "../mappers/openai-chat-mapper.js";

export function createDeepSeekProvider(
  config: LlmProviderRuntimeConfig & { apiKey: string },
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
      let completion: ChatCompletion;

      try {
        completion = await client.chat.completions.create(payload, {
          timeout: config.timeoutMs,
        });
      } catch (error) {
        throw new LlmProviderUpstreamError({
          provider: "deepseek",
          message:
            error instanceof Error ? error.message : "DeepSeek chat completion request failed",
          cause: error,
        });
      }

      if (!completion.choices[0]?.message) {
        throw new LlmProviderResponseError({
          provider: "deepseek",
          message: "DeepSeek chat completion returned no choices",
        });
      }

      return toLlmChatResponsePayload(completion, "deepseek");
    },
  };
}

function requireRequestModel(request: LlmChatRequest): string {
  if (!request.model) {
    throw new Error("DeepSeek provider requires an explicit model");
  }

  return request.model;
}
