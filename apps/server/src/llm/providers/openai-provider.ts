import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { LlmProvider } from "../provider.js";
import type { LlmChatRequest } from "../types.js";
import type { LlmProviderRuntimeConfig } from "../../config/config.manager.js";
import { LlmProviderResponseError, LlmProviderUpstreamError } from "../errors.js";
import { toLlmChatResponsePayload, toOpenAiChatRequest } from "../mappers/openai-chat-mapper.js";

export function createOpenAiProvider(
  config: LlmProviderRuntimeConfig & { apiKey: string },
): LlmProvider {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
  });

  return {
    id: "openai",
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
          provider: "openai",
          message: error instanceof Error ? error.message : "OpenAI chat completion request failed",
          cause: error,
        });
      }

      if (!completion.choices[0]?.message) {
        throw new LlmProviderResponseError({
          provider: "openai",
          message: "OpenAI chat completion returned no choices",
        });
      }

      return toLlmChatResponsePayload(completion, "openai");
    },
  };
}

function requireRequestModel(request: LlmChatRequest): string {
  if (!request.model) {
    throw new Error("OpenAI provider requires an explicit model");
  }

  return request.model;
}
