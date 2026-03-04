import OpenAI from "openai";
import type { LlmProvider } from "../provider.js";
import type { LlmChatRequest } from "../types.js";
import { env } from "../../env.js";
import { LlmProviderResponseError } from "../errors.js";
import { toLlmChatResponse, toOpenAiChatRequest } from "../mappers/openai-chat-mapper.js";

export function createDeepSeekProvider(): LlmProvider {
  const client = new OpenAI({
    apiKey: env.DEEPSEEK_API_KEY,
    baseURL: env.DEEPSEEK_BASE_URL,
    timeout: env.LLM_TIMEOUT_MS,
  });

  return {
    id: "deepseek",
    async chat(request: LlmChatRequest) {
      const model = request.model ?? env.DEEPSEEK_CHAT_MODEL;
      const payload = toOpenAiChatRequest({ model, request });
      const completion = await client.chat.completions.create(payload, {
        timeout: env.LLM_TIMEOUT_MS,
      });

      if (!completion.choices[0]?.message) {
        throw new LlmProviderResponseError(
          {
            provider: "deepseek",
            message: "DeepSeek chat completion returned no choices",
          },
        );
      }

      return toLlmChatResponse(completion, "deepseek");
    },
  };
}
