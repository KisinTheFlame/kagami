import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config/config.loader.js";
import { createEmbeddingClient } from "../../src/llm/embedding/client.js";
import type { EmbeddingProvider } from "../../src/llm/embedding/provider.js";

type StoryMemoryEmbeddingConfig = Config["server"]["agent"]["story"]["memory"]["embedding"];

const defaultConfig: StoryMemoryEmbeddingConfig = {
  provider: "google",
  apiKey: "key",
  baseUrl: "https://generativelanguage.googleapis.com",
  model: "gemini-embedding-001",
  outputDimensionality: 768,
};

describe("createEmbeddingClient", () => {
  it("should use config defaults when request omits model and dimensionality", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        embedding: [0.1, 0.2],
      }),
    };
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
    });

    await expect(
      client.embed({
        content: "hello world",
        outputDimensionality: 768,
        taskType: "RETRIEVAL_DOCUMENT",
      }),
    ).resolves.toEqual({
      provider: "google",
      model: "gemini-embedding-001",
      embedding: [0.1, 0.2],
    });

    expect(provider.embed).toHaveBeenCalledWith({
      content: "hello world",
      model: "gemini-embedding-001",
      outputDimensionality: 768,
      taskType: "RETRIEVAL_DOCUMENT",
    });
  });

  it("should respect request overrides for model and dimensionality", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "text-embedding-004",
        embedding: [0.3, 0.4],
      }),
    };
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
    });

    await client.embed({
      content: "override me",
      model: "text-embedding-004",
      outputDimensionality: 1536,
      taskType: "RETRIEVAL_QUERY",
    });

    expect(provider.embed).toHaveBeenCalledWith({
      content: "override me",
      model: "text-embedding-004",
      outputDimensionality: 1536,
      taskType: "RETRIEVAL_QUERY",
    });
  });

  it("should propagate provider failures", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockRejectedValue(new Error("provider failed")),
    };
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
    });

    await expect(
      client.embed({
        content: "hello world",
        outputDimensionality: 768,
        taskType: "RETRIEVAL_DOCUMENT",
      }),
    ).rejects.toThrow("provider failed");
  });
});
