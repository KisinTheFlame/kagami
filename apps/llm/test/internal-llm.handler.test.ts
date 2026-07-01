import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { isBizErrorWire } from "@kagami/kernel/errors/biz-error-wire";
import type { LlmClient } from "@kagami/llm-client";
import type { EmbeddingClient } from "@kagami/llm-client/embedding";
import { createLlmServiceApp } from "../src/app/llm-service-runtime.js";
import { InternalLlmHandler } from "../src/http/internal-llm.handler.js";

function buildApp(overrides?: {
  llmClient?: Partial<LlmClient>;
  embeddingClient?: Partial<EmbeddingClient>;
}): FastifyInstance {
  const llmClient = {
    chat: vi.fn(),
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn(),
    ...overrides?.llmClient,
  } as unknown as LlmClient;
  const embeddingClient = {
    embed: vi.fn(),
    ...overrides?.embeddingClient,
  } as unknown as EmbeddingClient;
  return createLlmServiceApp({
    handlers: [new InternalLlmHandler({ llmClient, embeddingClient })],
  });
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
});

describe("InternalLlmHandler", () => {
  it("routes /internal/chat to LlmClient.chat and returns the payload", async () => {
    const chat = vi
      .fn()
      .mockResolvedValue({ provider: "openai", model: "m", message: { role: "assistant" } });
    app = buildApp({ llmClient: { chat } });

    const response = await app.inject({
      method: "POST",
      url: "/internal/chat",
      payload: {
        request: { messages: [{ role: "user", content: "ping" }], tools: [], toolChoice: "none" },
        usage: "agent",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ provider: "openai", model: "m" });
    expect(chat).toHaveBeenCalledWith(
      { messages: [{ role: "user", content: "ping" }], tools: [], toolChoice: "none" },
      { usage: "agent" },
    );
  });

  it("serializes a thrown BizError into the rich error envelope", async () => {
    const chat = vi.fn().mockRejectedValue(
      new BizError({
        message: "所选 LLM provider 当前不可用",
        meta: { provider: "openai" },
        statusCode: 503,
      }),
    );
    app = buildApp({ llmClient: { chat } });

    const response = await app.inject({
      method: "POST",
      url: "/internal/chat",
      payload: { request: {}, usage: "agent" },
    });

    expect(response.statusCode).toBe(503);
    const body = response.json() as { error?: unknown };
    expect(isBizErrorWire(body.error)).toBe(true);
    expect(body.error).toMatchObject({
      name: "BizError",
      message: "所选 LLM provider 当前不可用",
      meta: { provider: "openai" },
      statusCode: 503,
    });
  });

  it("routes /internal/embed to EmbeddingClient.embed", async () => {
    const embed = vi.fn().mockResolvedValue({ provider: "google", model: "e", embedding: [0.1] });
    app = buildApp({ embeddingClient: { embed } });

    const response = await app.inject({
      method: "POST",
      url: "/internal/embed",
      payload: {
        request: { content: "hi", taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ provider: "google", model: "e", embedding: [0.1] });
  });
});
