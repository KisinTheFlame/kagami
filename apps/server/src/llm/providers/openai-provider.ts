import OpenAI from "openai";
import type { LlmProvider } from "../provider.js";
import type { LlmChatRequest } from "../types.js";
import { env } from "../../env.js";
import { LlmProviderResponseError } from "../errors.js";
import { toLlmChatResponse, toOpenAiChatRequest } from "../mappers/openai-chat-mapper.js";

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
      const completion = await client.chat.completions.create(payload, {
        timeout: env.LLM_TIMEOUT_MS,
      });

      if (!completion.choices[0]?.message) {
        throw new LlmProviderResponseError("openai", "OpenAI chat completion returned no choices");
      }

      return toLlmChatResponse(completion, "openai");
    },
  };
}
