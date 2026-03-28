import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RagEmbeddingRuntimeConfig } from "../../src/config/config.manager.js";
import type { EmbeddingCacheDao } from "../../src/llm/dao/embedding-cache.dao.js";
import { createEmbeddingClient } from "../../src/llm/embedding/client.js";
import type { EmbeddingProvider } from "../../src/llm/embedding/provider.js";

const defaultConfig: RagEmbeddingRuntimeConfig = {
  provider: "google",
  apiKey: "key",
  baseUrl: "https://generativelanguage.googleapis.com",
  model: "gemini-embedding-001",
  outputDimensionality: 768,
};

function createEmbeddingCacheDaoMock(): EmbeddingCacheDao {
  return {
    findByKey: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    countByQuery: vi.fn().mockResolvedValue(0),
    listByQueryPage: vi.fn().mockResolvedValue([]),
  };
}

describe("createEmbeddingClient", () => {
  it("should cache newly generated embeddings with a sha256 text hash", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        embedding: [0.1, 0.2],
      }),
    };
    const embeddingCacheDao = createEmbeddingCacheDaoMock();
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
      embeddingCacheDao,
    });

    await expect(
      client.embed({
        content: "hello world",
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      }),
    ).resolves.toEqual({
      provider: "google",
      model: "gemini-embedding-001",
      embedding: [0.1, 0.2],
    });

    expect(embeddingCacheDao.findByKey).toHaveBeenCalledWith({
      provider: "google",
      model: "gemini-embedding-001",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
      textHash: createHash("sha256").update("hello world").digest("hex"),
    });
    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(embeddingCacheDao.upsert).toHaveBeenCalledWith({
      provider: "google",
      model: "gemini-embedding-001",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
      text: "hello world",
      textHash: createHash("sha256").update("hello world").digest("hex"),
      embedding: [0.1, 0.2],
    });
  });

  it("should return cached embeddings without calling the provider again", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        embedding: [0.1, 0.2],
      }),
    };
    const embeddingCacheDao = createEmbeddingCacheDaoMock();
    vi.mocked(embeddingCacheDao.findByKey).mockResolvedValue({
      id: 1,
      provider: "google",
      model: "gemini-embedding-001",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
      text: "hello world",
      textHash: createHash("sha256").update("hello world").digest("hex"),
      embedding: [0.3, 0.4],
      createdAt: new Date("2026-03-15T00:00:00.000Z"),
    });
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
      embeddingCacheDao,
    });

    await expect(
      client.embed({
        content: "hello world",
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      }),
    ).resolves.toEqual({
      provider: "google",
      model: "gemini-embedding-001",
      embedding: [0.3, 0.4],
    });

    expect(provider.embed).not.toHaveBeenCalled();
    expect(embeddingCacheDao.upsert).not.toHaveBeenCalled();
  });

  it("should not reuse cached embeddings across different task types", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        embedding: [0.1, 0.2],
      }),
    };
    const embeddingCacheDao = createEmbeddingCacheDaoMock();
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
      embeddingCacheDao,
    });

    await client.embed({
      content: "shared text",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
    });
    await client.embed({
      content: "shared text",
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 768,
    });

    expect(embeddingCacheDao.findByKey).toHaveBeenNthCalledWith(1, {
      provider: "google",
      model: "gemini-embedding-001",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
      textHash: createHash("sha256").update("shared text").digest("hex"),
    });
    expect(embeddingCacheDao.findByKey).toHaveBeenNthCalledWith(2, {
      provider: "google",
      model: "gemini-embedding-001",
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 768,
      textHash: createHash("sha256").update("shared text").digest("hex"),
    });
    expect(provider.embed).toHaveBeenCalledTimes(2);
  });

  it("should not reuse cached embeddings across different output dimensionalities", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        embedding: [0.1, 0.2],
      }),
    };
    const embeddingCacheDao = createEmbeddingCacheDaoMock();
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
      embeddingCacheDao,
    });

    await client.embed({
      content: "shared text",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
    });
    await client.embed({
      content: "shared text",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 1536,
    });

    expect(embeddingCacheDao.findByKey).toHaveBeenNthCalledWith(1, {
      provider: "google",
      model: "gemini-embedding-001",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
      textHash: createHash("sha256").update("shared text").digest("hex"),
    });
    expect(embeddingCacheDao.findByKey).toHaveBeenNthCalledWith(2, {
      provider: "google",
      model: "gemini-embedding-001",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 1536,
      textHash: createHash("sha256").update("shared text").digest("hex"),
    });
    expect(provider.embed).toHaveBeenCalledTimes(2);
  });

  it("should not persist cache entries when the provider fails", async () => {
    const provider: EmbeddingProvider = {
      id: "google",
      embed: vi.fn().mockRejectedValue(new Error("provider failed")),
    };
    const embeddingCacheDao = createEmbeddingCacheDaoMock();
    const client = createEmbeddingClient({
      config: defaultConfig,
      provider,
      embeddingCacheDao,
    });

    await expect(
      client.embed({
        content: "hello world",
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      }),
    ).rejects.toThrow("provider failed");

    expect(embeddingCacheDao.upsert).not.toHaveBeenCalled();
  });
});
