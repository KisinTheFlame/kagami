import { describe, expect, it, vi } from "vitest";
import { DefaultLlmPlaygroundService } from "../../src/llm/application/llm-playground.impl.service.js";
import type { LlmClient } from "../../src/llm/client.js";

describe("DefaultLlmPlaygroundService", () => {
  it("should return available providers from llm client", async () => {
    const llmClient: LlmClient = {
      chat: vi.fn(),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([
        {
          id: "claude-code",
          models: ["claude-sonnet-4-20250514"],
        },
      ]),
    };

    const service = new DefaultLlmPlaygroundService({
      llmClient,
      playgroundToolDefinitions: [],
    });

    await expect(service.listProviders()).resolves.toEqual({
      providers: [
        {
          id: "claude-code",
          models: ["claude-sonnet-4-20250514"],
        },
      ],
    });
    expect(llmClient.listAvailableProviders).toHaveBeenCalledWith({ usage: "agent" });
  });

  it("should disable history recording and route to the selected provider", async () => {
    const chatDirect = vi.fn().mockResolvedValue({
      response: {
        provider: "deepseek",
        model: "deepseek-chat",
        message: {
          role: "assistant",
          content: "pong",
          toolCalls: [],
        },
      },
      nativeRequestPayload: {
        model: "deepseek-reasoner",
        messages: [{ role: "user", content: "describe" }],
      },
      nativeResponsePayload: null,
    });
    const llmClient: LlmClient = {
      chat: vi.fn(),
      chatDirect,
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };

    const service = new DefaultLlmPlaygroundService({
      llmClient,
      playgroundToolDefinitions: [
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

    await expect(service.listPlaygroundTools()).resolves.toEqual({
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

    await expect(
      service.chat({
        provider: "deepseek",
        model: "deepseek-reasoner",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "describe",
              },
              {
                type: "image",
                mimeType: "image/png",
                dataUrl: "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
                fileName: "cat.png",
              },
            ],
          },
        ],
        tools: [],
        toolChoice: "none",
      }),
    ).resolves.toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      message: {
        role: "assistant",
        content: "pong",
        toolCalls: [],
      },
      nativeRequestPayload: {
        model: "deepseek-reasoner",
        messages: [{ role: "user", content: "describe" }],
      },
    });

    expect(chatDirect).toHaveBeenCalledWith(
      {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "describe",
              },
              {
                type: "image",
                content: Buffer.from("image-bytes"),
                mimeType: "image/png",
                filename: "cat.png",
              },
            ],
          },
        ],
        tools: [],
        toolChoice: "none",
      },
      {
        providerId: "deepseek",
        model: "deepseek-reasoner",
        recordCall: false,
      },
    );
  });

  it("should reject invalid image data url", async () => {
    const llmClient: LlmClient = {
      chat: vi.fn(),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };

    const service = new DefaultLlmPlaygroundService({
      llmClient,
      playgroundToolDefinitions: [],
    });

    await expect(
      service.chat({
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                mimeType: "image/png",
                dataUrl: "invalid",
              },
            ],
          },
        ],
        tools: [],
        toolChoice: "none",
      }),
    ).rejects.toThrow("图片 dataUrl 不合法");
  });
});
