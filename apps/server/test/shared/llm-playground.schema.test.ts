import {
  LlmPlaygroundChatRequestSchema,
  LlmPlaygroundChatResponseSchema,
  LlmProviderListResponseSchema,
} from "@kagami/shared";
import { describe, expect, it } from "vitest";

describe("llm playground schemas", () => {
  it("should parse provider list response", () => {
    const result = LlmProviderListResponseSchema.parse({
      providers: [
        {
          id: "openai-codex",
          models: ["gpt-5.3-codex"],
        },
      ],
    });

    expect(result.providers).toHaveLength(1);
  });

  it("should parse playground chat request", () => {
    const result = LlmPlaygroundChatRequestSchema.parse({
      provider: "deepseek",
      model: "deepseek-chat",
      request: {
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        toolChoice: "none",
      },
    });

    expect(result.request.messages[0]).toEqual({
      role: "user",
      content: "hello",
    });
  });

  it("should parse playground chat response", () => {
    const result = LlmPlaygroundChatResponseSchema.parse({
      provider: "openai-codex",
      model: "gpt-5.3-codex",
      message: {
        role: "assistant",
        content: "pong",
        toolCalls: [],
      },
      usage: {
        promptTokens: 10,
        completionTokens: 2,
        totalTokens: 12,
      },
    });

    expect(result.usage?.totalTokens).toBe(12);
  });
});
