import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config/config.loader.js";
import type { EmbeddingCacheDao } from "../../src/llm/embedding/cache.dao.js";
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

  it("should return cached embeddings without calling provider", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn(),
    };
    const cacheDao: EmbeddingCacheDao = {
      findByKey: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
        text: "hello world",
        textHash: "cached-hash",
        embedding: [0.9, 0.8],
        createdAt: new Date("2026-04-02T00:00:00.000Z"),
      }),
      save: vi.fn(),
    };
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
      cacheDao,
    });

    await expect(
      client.embed({
        content: "hello world",
        outputDimensionality: 768,
        taskType: "RETRIEVAL_QUERY",
      }),
    ).resolves.toEqual({
      provider: "google",
      model: "gemini-embedding-001",
      embedding: [0.9, 0.8],
    });

    expect(cacheDao.findByKey).toHaveBeenCalledOnce();
    expect(provider.embed).not.toHaveBeenCalled();
    expect(cacheDao.save).not.toHaveBeenCalled();
  });

  it("should save provider responses to cache on miss", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "text-embedding-004",
        embedding: [0.3, 0.4],
      }),
    };
    const cacheDao: EmbeddingCacheDao = {
      findByKey: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
      cacheDao,
    });

    await expect(
      client.embed({
        content: "override me",
        model: "text-embedding-004",
        outputDimensionality: 1536,
        taskType: "RETRIEVAL_QUERY",
      }),
    ).resolves.toEqual({
      provider: "google",
      model: "text-embedding-004",
      embedding: [0.3, 0.4],
    });

    expect(cacheDao.findByKey).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        model: "text-embedding-004",
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 1536,
      }),
    );
    expect(cacheDao.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        model: "text-embedding-004",
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 1536,
        text: "override me",
        embedding: [0.3, 0.4],
      }),
    );
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

  it("should fall back to provider when cache reads fail", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        embedding: [0.1, 0.2],
      }),
    };
    const cacheDao: EmbeddingCacheDao = {
      findByKey: vi.fn().mockRejectedValue(new Error("cache read failed")),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
      cacheDao,
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

    expect(provider.embed).toHaveBeenCalledOnce();
    expect(cacheDao.save).toHaveBeenCalledOnce();
  });

  it("should return provider responses even when cache writes fail", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        embedding: [0.1, 0.2],
      }),
    };
    const cacheDao: EmbeddingCacheDao = {
      findByKey: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockRejectedValue(new Error("cache write failed")),
    };
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
      cacheDao,
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

    expect(provider.embed).toHaveBeenCalledOnce();
    expect(cacheDao.save).toHaveBeenCalledOnce();
  });
});
