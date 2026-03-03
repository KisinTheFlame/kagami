import OpenAI from "openai";
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import { env } from "../env.js";

const client = new OpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: env.DEEPSEEK_BASE_URL,
});

type CreateChatCompletionInput = {
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  toolChoice?: ChatCompletionToolChoiceOption;
  temperature?: number;
};

export async function createChatCompletion({
  messages,
  tools,
  toolChoice,
  temperature = 0.2,
}: CreateChatCompletionInput): Promise<ChatCompletionMessage> {
  const requestPayload = {
    model: env.DEEPSEEK_CHAT_MODEL,
    messages,
    tools,
    tool_choice: toolChoice,
    temperature,
  };
  const startedAt = Date.now();

  console.info(
    JSON.stringify({
      scope: "llm",
      event: "request",
      timestamp: new Date().toISOString(),
      payload: requestPayload,
    }),
  );

  try {
    const completion = await client.chat.completions.create(requestPayload);

    console.info(
      JSON.stringify({
        scope: "llm",
        event: "response",
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        payload: completion,
      }),
    );

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error("DeepSeek chat completion returned no choices");
    }

    return message;
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "llm",
        event: "error",
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? { name: error.name, message: error.message } : error,
      }),
    );

    throw error;
  }
}
