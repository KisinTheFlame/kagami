import {
  LlmPlaygroundChatRequestSchema,
  LlmPlaygroundChatResponseSchema,
  LlmPlaygroundToolListResponseSchema,
  LlmProviderListResponseSchema,
} from "@kagami/shared/schemas/llm-chat";
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
      system: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "hello",
            },
            {
              type: "image",
              mimeType: "image/png",
              dataUrl: "data:image/png;base64,aGVsbG8=",
              fileName: "hello.png",
            },
          ],
        },
      ],
      tools: [],
      toolChoice: "none",
    });

    expect(result.messages[0]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "hello",
        },
        {
          type: "image",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,aGVsbG8=",
          fileName: "hello.png",
        },
      ],
    });
  });

  it("should reject assistant image content", () => {
    expect(() =>
      LlmPlaygroundChatRequestSchema.parse({
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "image",
                mimeType: "image/png",
                dataUrl: "data:image/png;base64,aGVsbG8=",
              },
            ],
            toolCalls: [],
          },
        ],
        tools: [],
        toolChoice: "none",
      }),
    ).toThrow();
  });

  it("should parse playground tool list response", () => {
    const result = LlmPlaygroundToolListResponseSchema.parse({
      tools: [
        {
          name: "search_web",
          description: "search",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      ],
    });

    expect(result.tools).toHaveLength(1);
  });

  it("should reject empty tool choice tool name", () => {
    expect(() =>
      LlmPlaygroundChatRequestSchema.parse({
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: {
          tool_name: "",
        },
      }),
    ).toThrow();
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
