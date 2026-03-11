import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmPlaygroundService } from "../../src/service/llm-playground.service.js";
import { LlmHandler } from "../../src/handler/llm.handler.js";

describe("LlmHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should list configured providers", async () => {
    const listProviders = vi.fn().mockResolvedValue({
      providers: [
        {
          id: "openai",
          models: ["gpt-4o-mini"],
        },
      ],
    });
    const llmPlaygroundService: LlmPlaygroundService = {
      listProviders,
      chat: vi.fn(),
    };

    const handler = new LlmHandler({ llmPlaygroundService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/llm/providers",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providers: [
        {
          id: "openai",
          models: ["gpt-4o-mini"],
        },
      ],
    });
    expect(listProviders).toHaveBeenCalledTimes(1);
  });

  it("should execute a chat playground request", async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: "openai-codex",
      model: "gpt-5.3-codex",
      message: {
        role: "assistant",
        content: "pong",
        toolCalls: [],
      },
      usage: {
        totalTokens: 12,
      },
    });
    const llmPlaygroundService: LlmPlaygroundService = {
      listProviders: vi.fn(),
      chat,
    };

    const handler = new LlmHandler({ llmPlaygroundService });
    handler.register(app);

    const payload = {
      provider: "openai-codex",
      model: "gpt-5.3-codex",
      request: {
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/llm/chat",
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      provider: "openai-codex",
      model: "gpt-5.3-codex",
      message: {
        role: "assistant",
        content: "pong",
        toolCalls: [],
      },
      usage: {
        totalTokens: 12,
      },
    });
    expect(chat).toHaveBeenCalledWith(payload);
  });
});
