import { describe, expect, it, vi } from "vitest";
import { formatStoryMarkdown } from "../../src/agent/capabilities/story/domain/story-markdown.js";
import { DefaultStoryReindexService } from "../../src/ops/application/story-reindex.impl.service.js";

describe("DefaultStoryReindexService", () => {
  it("should reindex only outdated stories in outdated mode", async () => {
    const freshStory = createStoryRecord("story-fresh");
    const staleModelStory = createStoryRecord("story-stale-model");
    const missingStory = createStoryRecord("story-missing");
    const partialStory = createStoryRecord("story-partial");
    const wrongKindsStory = createStoryRecord("story-wrong-kinds");
    const storyDao = {
      countAll: vi.fn().mockResolvedValue(5),
      listPage: vi
        .fn()
        .mockResolvedValueOnce([
          freshStory,
          staleModelStory,
          missingStory,
          partialStory,
          wrongKindsStory,
        ])
        .mockResolvedValueOnce([]),
      create: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findManyByIds: vi.fn(),
    };
    const storyMemoryDocumentDao = {
      replaceForStory: vi.fn(),
      findIndexMetadataByStoryIds: vi
        .fn()
        .mockResolvedValue([
          ...createMetadataRows("story-fresh", "gemini-embedding-001", 768),
          ...createMetadataRows("story-stale-model", "old-model", 768),
          ...createMetadataRows("story-partial", "gemini-embedding-001", 768).slice(0, 2),
          ...createWrongKindMetadataRows("story-wrong-kinds", "gemini-embedding-001", 768),
        ]),
      searchSimilar: vi.fn(),
    };
    const reindexStory = vi.fn().mockResolvedValue(undefined);
    const service = new DefaultStoryReindexService({
      storyDao,
      storyMemoryDocumentDao,
      storyMemoryIndexService: {
        reindexStory,
      } as never,
      embeddingModel: "gemini-embedding-001",
      outputDimensionality: 768,
    });

    const result = await service.reindex({
      mode: "outdated",
      pageSize: 50,
    });

    expect(storyDao.listPage).toHaveBeenNthCalledWith(1, {
      page: 1,
      pageSize: 50,
      orderBy: "createdAtAsc",
    });
    expect(reindexStory).toHaveBeenCalledTimes(4);
    expect(reindexStory).toHaveBeenCalledWith(staleModelStory);
    expect(reindexStory).toHaveBeenCalledWith(missingStory);
    expect(reindexStory).toHaveBeenCalledWith(partialStory);
    expect(reindexStory).toHaveBeenCalledWith(wrongKindsStory);
    expect(result).toEqual({
      mode: "outdated",
      totalStories: 5,
      targetedStories: 4,
      reindexedStories: 4,
      skippedStories: 1,
      failedStories: 0,
      failures: [],
    });
  });

  it("should reindex all stories and continue after failures", async () => {
    const firstStory = createStoryRecord("story-1");
    const secondStory = createStoryRecord("story-2");
    const thirdStory = createStoryRecord("story-3");
    const storyDao = {
      countAll: vi.fn().mockResolvedValue(3),
      listPage: vi
        .fn()
        .mockResolvedValueOnce([firstStory, secondStory])
        .mockResolvedValueOnce([thirdStory])
        .mockResolvedValueOnce([]),
      create: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findManyByIds: vi.fn(),
    };
    const storyMemoryDocumentDao = {
      replaceForStory: vi.fn(),
      findIndexMetadataByStoryIds: vi.fn(),
      searchSimilar: vi.fn(),
    };
    const reindexStory = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const service = new DefaultStoryReindexService({
      storyDao,
      storyMemoryDocumentDao,
      storyMemoryIndexService: {
        reindexStory,
      } as never,
      embeddingModel: "gemini-embedding-001",
      outputDimensionality: 768,
    });

    const result = await service.reindex({
      mode: "all",
      pageSize: 2,
    });

    expect(storyMemoryDocumentDao.findIndexMetadataByStoryIds).not.toHaveBeenCalled();
    expect(storyDao.listPage).toHaveBeenNthCalledWith(1, {
      page: 1,
      pageSize: 2,
      orderBy: "createdAtAsc",
    });
    expect(storyDao.listPage).toHaveBeenNthCalledWith(2, {
      page: 2,
      pageSize: 2,
      orderBy: "createdAtAsc",
    });
    expect(result).toEqual({
      mode: "all",
      totalStories: 3,
      targetedStories: 3,
      reindexedStories: 2,
      skippedStories: 0,
      failedStories: 1,
      failures: [
        {
          storyId: "story-2",
          message: "boom",
        },
      ],
    });
  });
});

function createStoryRecord(id: string) {
  const content = {
    title: `${id}-title`,
    time: "今天",
    scene: "群聊",
    people: ["Alice"],
    cause: "起因",
    process: ["经过一", "经过二"],
    result: "结果",
    impact: "影响",
  };

  return {
    id,
    markdown: formatStoryMarkdown(content),
    content,
    sourceMessageSeqStart: 1,
    sourceMessageSeqEnd: 3,
    createdAt: new Date("2026-04-08T00:00:00.000Z"),
    updatedAt: new Date("2026-04-08T00:00:00.000Z"),
  };
}

function createMetadataRows(storyId: string, embeddingModel: string, embeddingDim: number) {
  return [
    {
      storyId,
      kind: "overview" as const,
      embeddingModel,
      embeddingDim,
    },
    {
      storyId,
      kind: "people_scene" as const,
      embeddingModel,
      embeddingDim,
    },
    {
      storyId,
      kind: "process" as const,
      embeddingModel,
      embeddingDim,
    },
  ];
}

function createWrongKindMetadataRows(
  storyId: string,
  embeddingModel: string,
  embeddingDim: number,
) {
  return [
    {
      storyId,
      kind: "overview" as const,
      embeddingModel,
      embeddingDim,
    },
    {
      storyId,
      kind: "overview" as const,
      embeddingModel,
      embeddingDim,
    },
    {
      storyId,
      kind: "process" as const,
      embeddingModel,
      embeddingDim,
    },
  ];
}
