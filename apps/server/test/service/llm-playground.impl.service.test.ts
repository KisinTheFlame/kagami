import { describe, expect, it, vi } from "vitest";
import { DefaultLlmPlaygroundService } from "../../src/service/llm-playground.impl.service.js";
import type { LlmClient } from "../../src/llm/client.js";

describe("DefaultLlmPlaygroundService", () => {
  it("should return available providers from llm client", () => {
    const llmClient: LlmClient = {
      chat: vi.fn(),
      listAvailableProviders: vi.fn().mockReturnValue([
        {
          id: "openai",
          defaultModel: "gpt-4o-mini",
          isActive: true,
        },
      ]),
    };

    const service = new DefaultLlmPlaygroundService({ llmClient });

    expect(service.listProviders()).toEqual({
      providers: [
        {
          id: "openai",
          defaultModel: "gpt-4o-mini",
          isActive: true,
        },
      ],
    });
  });

  it("should disable history recording and route to the selected provider", async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: "deepseek",
      model: "deepseek-chat",
      message: {
        role: "assistant",
        content: "pong",
        toolCalls: [],
      },
    });
    const llmClient: LlmClient = {
      chat,
      listAvailableProviders: vi.fn().mockReturnValue([]),
    };

    const service = new DefaultLlmPlaygroundService({ llmClient });

    await service.chat({
      provider: "deepseek",
      model: "deepseek-reasoner",
      request: {
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      },
    });

    expect(chat).toHaveBeenCalledWith(
      {
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
        model: "deepseek-reasoner",
      },
      {
        providerId: "deepseek",
        recordCall: false,
      },
    );
  });
});
