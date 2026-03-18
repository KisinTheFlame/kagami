import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/db/client.js";
import { PrismaEmbeddingCacheDao } from "../../src/dao/impl/embedding-cache.impl.dao.js";

describe("PrismaEmbeddingCacheDao", () => {
  it("should query cache entries by the full compound key", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 1,
      provider: "google",
      model: "gemini-embedding-001",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
      text: "hello world",
      textHash: "abc123",
      embedding: [0.1, 0.2],
      createdAt: new Date("2026-03-15T00:00:00.000Z"),
    });
    const database = {
      embeddingCache: {
        findUnique,
        upsert: vi.fn(),
      },
    } as unknown as Database;

    const dao = new PrismaEmbeddingCacheDao({ database });

    await expect(
      dao.findByKey({
        provider: "google",
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
        textHash: "abc123",
      }),
    ).resolves.toEqual({
      id: 1,
      provider: "google",
      model: "gemini-embedding-001",
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 768,
      text: "hello world",
      textHash: "abc123",
      embedding: [0.1, 0.2],
      createdAt: new Date("2026-03-15T00:00:00.000Z"),
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        provider_model_taskType_outputDimensionality_textHash: {
          provider: "google",
          model: "gemini-embedding-001",
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 768,
          textHash: "abc123",
        },
      },
    });
  });

  it("should upsert cache entries idempotently and preserve embedding arrays", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const database = {
      embeddingCache: {
        findUnique: vi.fn(),
        upsert,
      },
    } as unknown as Database;

    const dao = new PrismaEmbeddingCacheDao({ database });

    await expect(
      dao.upsert({
        provider: "google",
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
        text: "hello world",
        textHash: "abc123",
        embedding: [0.1, 0.2],
      }),
    ).resolves.toBeUndefined();

    expect(upsert).toHaveBeenCalledWith({
      where: {
        provider_model_taskType_outputDimensionality_textHash: {
          provider: "google",
          model: "gemini-embedding-001",
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 768,
          textHash: "abc123",
        },
      },
      update: {
        text: "hello world",
        embedding: [0.1, 0.2],
      },
      create: {
        provider: "google",
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
        text: "hello world",
        textHash: "abc123",
        embedding: [0.1, 0.2],
      },
    });
  });

  it("should build filters, sort by latest first, and map embedding previews", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 2,
        provider: "google",
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
        text: "find this",
        textHash: "hash-2",
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
        createdAt: new Date("2026-03-15T11:00:00.000Z"),
      },
    ]);
    const database = {
      embeddingCache: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        count,
        findMany,
      },
    } as unknown as Database;

    const dao = new PrismaEmbeddingCacheDao({ database });

    await expect(
      dao.countByQuery({
        provider: "google",
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
        textHash: "hash-2",
        text: "find",
        startAt: "2026-03-15T10:00:00.000Z",
        endAt: "2026-03-15T12:00:00.000Z",
      }),
    ).resolves.toBe(1);

    await expect(
      dao.listByQueryPage({
        page: 1,
        pageSize: 20,
        provider: "google",
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
        textHash: "hash-2",
        text: "find",
        startAt: "2026-03-15T10:00:00.000Z",
        endAt: "2026-03-15T12:00:00.000Z",
      }),
    ).resolves.toEqual([
      {
        id: 2,
        provider: "google",
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
        text: "find this",
        textHash: "hash-2",
        embeddingPreview: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
        embeddingDim: 9,
        createdAt: new Date("2026-03-15T11:00:00.000Z"),
      },
    ]);

    expect(count).toHaveBeenCalledWith({
      where: {
        provider: "google",
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
        textHash: "hash-2",
        text: {
          contains: "find",
          mode: "insensitive",
        },
        createdAt: {
          gte: new Date("2026-03-15T10:00:00.000Z"),
          lte: new Date("2026-03-15T12:00:00.000Z"),
        },
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        provider: "google",
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
        textHash: "hash-2",
        text: {
          contains: "find",
          mode: "insensitive",
        },
        createdAt: {
          gte: new Date("2026-03-15T10:00:00.000Z"),
          lte: new Date("2026-03-15T12:00:00.000Z"),
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      skip: 0,
      select: {
        id: true,
        provider: true,
        model: true,
        taskType: true,
        outputDimensionality: true,
        text: true,
        textHash: true,
        embedding: true,
        createdAt: true,
      },
    });
  });
});
