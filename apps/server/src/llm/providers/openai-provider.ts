import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { LlmProvider } from "../provider.js";
import type { LlmChatRequest } from "../types.js";
import { env } from "../../env.js";
import { LlmProviderResponseError, LlmProviderUpstreamError } from "../errors.js";
import { toLlmChatResponsePayload, toOpenAiChatRequest } from "../mappers/openai-chat-mapper.js";

export function createOpenAiProvider(): LlmProvider {
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
    timeout: env.LLM_TIMEOUT_MS,
  });

  return {
    id: "openai",
    async chat(request: LlmChatRequest) {
      const model = request.model ?? env.OPENAI_CHAT_MODEL;
      const payload = toOpenAiChatRequest({ model, request });
      let completion: ChatCompletion;

      try {
        completion = await client.chat.completions.create(payload, {
          timeout: env.LLM_TIMEOUT_MS,
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
