import { describe, expect, it, vi } from "vitest";
import type { EmbeddingCacheDao } from "../../src/dao/embedding-cache.dao.js";
import { DefaultEmbeddingCacheQueryService } from "../../src/service/embedding-cache-query.impl.service.js";

describe("DefaultEmbeddingCacheQueryService", () => {
  it("should return paginated embedding cache items", async () => {
    const embeddingCacheDao: EmbeddingCacheDao = {
      findByKey: vi.fn(),
      upsert: vi.fn(),
      countByQuery: vi.fn().mockResolvedValue(1),
      listByQueryPage: vi.fn().mockResolvedValue([
        {
          id: 1,
          provider: "google",
          model: "gemini-embedding-001",
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 768,
          text: "hello world",
          textHash: "abc123",
          embeddingPreview: [0.1, 0.2],
          embeddingDim: 768,
          createdAt: new Date("2026-03-15T10:00:00.000Z"),
        },
      ]),
    };

    const service = new DefaultEmbeddingCacheQueryService({
      embeddingCacheDao,
    });

    await expect(
      service.queryList({
        page: 1,
        pageSize: 20,
        provider: "google",
      }),
    ).resolves.toEqual({
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
      },
      items: [
        {
          id: 1,
          provider: "google",
          model: "gemini-embedding-001",
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 768,
          text: "hello world",
          textHash: "abc123",
          embeddingPreview: [0.1, 0.2],
          embeddingDim: 768,
          createdAt: "2026-03-15T10:00:00.000Z",
        },
      ],
    });

    expect(embeddingCacheDao.countByQuery).toHaveBeenCalledWith({
      provider: "google",
      model: undefined,
      taskType: undefined,
      outputDimensionality: undefined,
      textHash: undefined,
      text: undefined,
      startAt: undefined,
      endAt: undefined,
    });
    expect(embeddingCacheDao.listByQueryPage).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      provider: "google",
    });
  });
});
