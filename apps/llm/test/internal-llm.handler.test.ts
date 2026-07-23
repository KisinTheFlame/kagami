import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { isBizErrorWire } from "@kagami/kernel/errors/biz-error-wire";
import type { LlmClient } from "@kagami/llm-client";
import type { EmbeddingClient } from "@kagami/llm-client/embedding";
import type { ImageClient } from "@kagami/llm-client/image";
import { createLlmServiceApp } from "../src/app/llm-service-runtime.js";
import { InternalLlmHandler } from "../src/http/internal-llm.handler.js";

function buildApp(overrides?: {
  llmClient?: Partial<LlmClient>;
  embeddingClient?: Partial<EmbeddingClient>;
  imageClient?: Partial<ImageClient>;
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
  const imageClient = {
    generate: vi.fn(),
    ...overrides?.imageClient,
  } as unknown as ImageClient;
  return createLlmServiceApp({
    handlers: [new InternalLlmHandler({ llmClient, embeddingClient, imageClient })],
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
        scene: "agent",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ provider: "openai", model: "m" });
    expect(chat).toHaveBeenCalledWith(
      { messages: [{ role: "user", content: "ping" }], tools: [], toolChoice: "none" },
      { usage: "agent", scene: "agent" },
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
      payload: { request: {}, usage: "agent", scene: "agent" },
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

  it("routes /internal/generate-image and base64-encodes the raw bytes", async () => {
    const generate = vi.fn().mockResolvedValue({
      provider: "openai-codex",
      model: "gpt-5.4",
      image: { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
      revisedPrompt: "a red circle",
      size: "1024x1024",
    });
    app = buildApp({ imageClient: { generate } });

    const response = await app.inject({
      method: "POST",
      url: "/internal/generate-image",
      payload: { request: { prompt: "a red circle" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      provider: "openai-codex",
      model: "gpt-5.4",
      mimeType: "image/png",
      imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
      revisedPrompt: "a red circle",
      size: "1024x1024",
    });
    expect(generate).toHaveBeenCalledWith({ prompt: "a red circle" });
  });
});
