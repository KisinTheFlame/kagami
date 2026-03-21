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
          id: "claude-code",
          models: ["claude-sonnet-4-20250514"],
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
      provider: "claude-code",
      model: "claude-sonnet-4-20250514",
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
