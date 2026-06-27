import { describe, expect, it, vi } from "vitest";
import { StoryRecallService } from "../../src/agent/capabilities/story/application/story-recall.service.js";

describe("StoryRecallService", () => {
  it("should search only within the current embedding model and dimensionality", async () => {
    const embeddingClient = {
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        embedding: [0.5, 0.5],
      }),
    };
    const storyMemoryDocumentDao = {
      replaceForStory: vi.fn(),
      findIndexMetadataByStoryIds: vi.fn(),
      searchSimilar: vi.fn().mockResolvedValue([]),
    };
    const storyDao = {
      create: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findManyByIds: vi.fn().mockResolvedValue([]),
      countAll: vi.fn(),
      listPage: vi.fn(),
    };
    const service = new StoryRecallService({
      storyMemoryDocumentDao,
      storyDao,
      embeddingClient,
      embeddingModel: "gemini-embedding-001",
      outputDimensionality: 768,
    });

    const result = await service.search({
      query: "测试",
      topK: 3,
    });

    expect(result).toEqual([]);
    expect(storyMemoryDocumentDao.searchSimilar).toHaveBeenCalledWith({
      queryEmbedding: expect.any(Array),
      topK: 9,
      embeddingModel: "gemini-embedding-001",
      embeddingDim: 768,
    });
  });
});
