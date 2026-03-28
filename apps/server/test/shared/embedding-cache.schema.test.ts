import {
  EmbeddingCacheListQuerySchema,
  EmbeddingCacheListResponseSchema,
} from "@kagami/shared/schemas/embedding-cache";
import { describe, expect, it } from "vitest";

describe("embedding cache schemas", () => {
  it("should normalize optional query inputs", () => {
    const result = EmbeddingCacheListQuerySchema.parse({
      page: "1",
      pageSize: "20",
      provider: " google ",
      model: " gemini-embedding-001 ",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: "768",
      textHash: " abc123 ",
      text: " hello ",
      startAt: "2026-03-15T10:00:00.000Z",
      endAt: "2026-03-15T11:00:00.000Z",
    });

    expect(result).toEqual({
      page: 1,
      pageSize: 20,
      provider: "google",
      model: "gemini-embedding-001",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
      textHash: "abc123",
      text: "hello",
      startAt: "2026-03-15T10:00:00.000Z",
      endAt: "2026-03-15T11:00:00.000Z",
    });
  });

  it("should parse paginated embedding cache responses", () => {
    const result = EmbeddingCacheListResponseSchema.parse({
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

    expect(result.items[0]?.embeddingDim).toBe(768);
  });
});
