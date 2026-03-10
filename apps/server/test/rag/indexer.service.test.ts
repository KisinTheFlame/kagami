import { describe, expect, it, vi } from "vitest";
import { GroupMessageChunkIndexer } from "../../src/rag/indexer.service.js";
import type { EmbeddingClient } from "../../src/llm/embedding/client.js";
import type { NapcatGroupMessageChunkDao } from "../../src/dao/napcat-group-message-chunk.dao.js";

describe("GroupMessageChunkIndexer", () => {
  it("should normalize embeddings before marking chunk indexed", async () => {
    const chunkDao: NapcatGroupMessageChunkDao = {
      insert: vi.fn(),
      findById: vi.fn().mockResolvedValue({
        id: 1,
        sourceMessageId: 10,
        groupId: "123456",
        chunkIndex: 0,
        content: "hello",
        status: "pending",
        embeddingModel: null,
        embeddingDim: null,
        errorMessage: null,
        indexedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      markIndexed: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      searchSimilar: vi.fn(),
    };
    const embeddingClient: EmbeddingClient = {
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        embedding: [3, 4],
      }),
    };
    const indexer = new GroupMessageChunkIndexer({
      chunkDao,
      embeddingClient,
      outputDimensionality: 768,
    });

    indexer.enqueue(1);
    await vi.waitFor(() => {
      expect(chunkDao.markIndexed).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          embeddingModel: "gemini-embedding-001",
          embeddingDim: 2,
          normalizedEmbedding: [0.6, 0.8],
        }),
      );
    });
  });

  it("should mark chunk failed when content is empty", async () => {
    const chunkDao: NapcatGroupMessageChunkDao = {
      insert: vi.fn(),
      findById: vi.fn().mockResolvedValue({
        id: 1,
        sourceMessageId: 10,
        groupId: "123456",
        chunkIndex: 0,
        content: "   ",
        status: "pending",
        embeddingModel: null,
        embeddingDim: null,
        errorMessage: null,
        indexedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      markIndexed: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      searchSimilar: vi.fn(),
    };
    const embeddingClient: EmbeddingClient = {
      embed: vi.fn(),
    };
    const indexer = new GroupMessageChunkIndexer({
      chunkDao,
      embeddingClient,
      outputDimensionality: 768,
    });

    indexer.enqueue(1);
    await vi.waitFor(() => {
      expect(chunkDao.markFailed).toHaveBeenCalledWith({
        id: 1,
        errorMessage: "Chunk content is empty",
      });
    });
  });
});
