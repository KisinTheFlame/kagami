import { describe, expect, it, vi } from "vitest";
import { DefaultLlmPlaygroundService } from "../../src/service/llm-playground.impl.service.js";
import type { LlmClient } from "../../src/llm/client.js";

describe("DefaultLlmPlaygroundService", () => {
  it("should return available providers from llm client", async () => {
    const llmClient: LlmClient = {
      chat: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([
        {
          id: "openai-codex",
          defaultModel: "gpt-5.3-codex",
          isActive: true,
        },
      ]),
    };

    const service = new DefaultLlmPlaygroundService({ llmClient });

    await expect(service.listProviders()).resolves.toEqual({
      providers: [
        {
          id: "openai-codex",
          defaultModel: "gpt-5.3-codex",
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
      listAvailableProviders: vi.fn().mockResolvedValue([]),
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
