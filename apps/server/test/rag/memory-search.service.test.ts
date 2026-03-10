import { describe, expect, it, vi } from "vitest";
import { GroupMessageMemorySearchService } from "../../src/rag/memory-search.service.js";
import type { EmbeddingClient } from "../../src/llm/embedding/client.js";
import type { NapcatGroupMessageChunkDao } from "../../src/dao/napcat-group-message-chunk.dao.js";
import type { NapcatGroupMessageDao } from "../../src/dao/napcat-group-message.dao.js";

describe("GroupMessageMemorySearchService", () => {
  it("should format matched windows into memory history blocks", async () => {
    const embeddingClient: EmbeddingClient = {
      embed: vi.fn().mockResolvedValue({
        provider: "google",
        model: "gemini-embedding-001",
        embedding: [3, 4],
      }),
    };
    const chunkDao: NapcatGroupMessageChunkDao = {
      insert: vi.fn(),
      findById: vi.fn(),
      markIndexed: vi.fn(),
      markFailed: vi.fn(),
      searchSimilar: vi.fn().mockResolvedValue([
        {
          chunkId: 1,
          sourceMessageId: 101,
          groupId: "123456",
          content: "命中一",
          score: 0.91,
        },
        {
          chunkId: 2,
          sourceMessageId: 202,
          groupId: "123456",
          content: "命中二",
          score: 0.75,
        },
      ]),
    };
    const groupMessageDao: NapcatGroupMessageDao = {
      insert: vi.fn(),
      countByQuery: vi.fn(),
      listByQueryPage: vi.fn(),
      listContextWindowById: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 100,
            groupId: "123456",
            userId: "1",
            nickname: "甲",
            messageText: "前文一",
            eventTime: new Date("2026-03-11T02:00:00.000Z"),
            createdAt: new Date("2026-03-11T02:00:00.000Z"),
          },
          {
            id: 101,
            groupId: "123456",
            userId: "2",
            nickname: "乙",
            messageText: "命中一",
            eventTime: new Date("2026-03-11T02:00:01.000Z"),
            createdAt: new Date("2026-03-11T02:00:01.000Z"),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 202,
            groupId: "123456",
            userId: "3",
            nickname: "丙",
            messageText: "命中二",
            eventTime: new Date("2026-03-11T02:10:00.000Z"),
            createdAt: new Date("2026-03-11T02:10:00.000Z"),
          },
        ]),
    };

    const service = new GroupMessageMemorySearchService({
      config: {
        embedding: {
          provider: "google",
          apiKey: "key",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-embedding-001",
          outputDimensionality: 768,
        },
        retrieval: {
          topK: 3,
        },
      },
      embeddingClient,
      chunkDao,
      groupMessageDao,
    });

    await expect(
      service.search({
        groupId: "123456",
        query: "旧话题",
      }),
    ).resolves.toBe(
      [
        "<memory_history_message>",
        "时间：2026-03-11 10:00:01",
        "<message>",
        "甲 (1):",
        "前文一",
        "</message>",
        "<message>",
        "乙 (2):",
        "命中一",
        "</message>",
        "</memory_history_message>",
        "<memory_history_message>",
        "时间：2026-03-11 10:10:00",
        "<message>",
        "丙 (3):",
        "命中二",
        "</message>",
        "</memory_history_message>",
      ].join("\n"),
    );
  });
});
