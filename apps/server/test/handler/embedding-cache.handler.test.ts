import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingCacheHandler } from "../../src/handler/embedding-cache.handler.js";
import type { EmbeddingCacheQueryService } from "../../src/service/embedding-cache-query.service.js";

describe("EmbeddingCacheHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should query embedding cache via injected service", async () => {
    const result = {
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
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const queryList = vi.fn().mockResolvedValue(result);
    const embeddingCacheQueryService: EmbeddingCacheQueryService = {
      queryList,
    };

    const handler = new EmbeddingCacheHandler({ embeddingCacheQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/embedding-cache/query?page=1&pageSize=20&provider=google&taskType=RETRIEVAL_DOCUMENT",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(queryList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        provider: "google",
        taskType: "RETRIEVAL_DOCUMENT",
      }),
    );
  });
});
