import { describe, expect, it, vi } from "vitest";
import type { Database } from "../src/infra/db/client.js";
import { PrismaClaudeFileCacheDao } from "../src/infra/prisma-claude-file-cache.dao.js";

describe("PrismaClaudeFileCacheDao", () => {
  it("findByHash 映射行（含 lastUsedAt）", async () => {
    const lastUsedAt = new Date("2026-07-01T00:00:00Z");
    const findUnique = vi.fn().mockResolvedValue({
      contentSha256: "sha",
      fileId: "file_1",
      mimeType: "image/png",
      sizeBytes: 42,
      createdAt: new Date(0),
      lastUsedAt,
    });
    const database = { claudeFileCache: { findUnique } } as unknown as Database;

    await expect(new PrismaClaudeFileCacheDao({ database }).findByHash("sha")).resolves.toEqual({
      contentSha256: "sha",
      fileId: "file_1",
      mimeType: "image/png",
      sizeBytes: 42,
      lastUsedAt,
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { contentSha256: "sha" } });
  });

  it("findByHash 未命中回 null", async () => {
    const database = {
      claudeFileCache: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Database;
    await expect(new PrismaClaudeFileCacheDao({ database }).findByHash("x")).resolves.toBeNull();
  });

  it("save upsert：create 不含 lastUsedAt（由 default(now) 填）", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const database = { claudeFileCache: { upsert } } as unknown as Database;

    await new PrismaClaudeFileCacheDao({ database }).save({
      contentSha256: "sha",
      fileId: "file_1",
      mimeType: "image/png",
      sizeBytes: 42,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { contentSha256: "sha" },
      create: { contentSha256: "sha", fileId: "file_1", mimeType: "image/png", sizeBytes: 42 },
      update: { fileId: "file_1", mimeType: "image/png", sizeBytes: 42 },
    });
  });

  it("touch：条件 updateMany（仅刷新早于节流窗的行）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = { claudeFileCache: { updateMany } } as unknown as Database;

    const before = Date.now();
    await new PrismaClaudeFileCacheDao({ database }).touch("sha");

    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0] as {
      where: { contentSha256: string; lastUsedAt: { lt: Date } };
      data: { lastUsedAt: Date };
    };
    expect(arg.where.contentSha256).toBe("sha");
    // 节流窗 6h：where.lastUsedAt.lt ≈ now - 6h（早于 now）。
    expect(arg.where.lastUsedAt.lt).toBeInstanceOf(Date);
    expect(arg.where.lastUsedAt.lt.getTime()).toBeLessThan(before);
    expect(arg.data.lastUsedAt).toBeInstanceOf(Date);
  });

  it("findIdle：lastUsedAt < cutoff，asc，take limit，映射行", async () => {
    const cutoff = new Date("2026-07-02T00:00:00Z");
    const findMany = vi.fn().mockResolvedValue([
      {
        contentSha256: "sha",
        fileId: "file_1",
        mimeType: "image/png",
        sizeBytes: 1,
        createdAt: new Date(0),
        lastUsedAt: new Date(0),
      },
    ]);
    const database = { claudeFileCache: { findMany } } as unknown as Database;

    const rows = await new PrismaClaudeFileCacheDao({ database }).findIdle({ cutoff, limit: 500 });

    expect(findMany).toHaveBeenCalledWith({
      where: { lastUsedAt: { lt: cutoff } },
      orderBy: { lastUsedAt: "asc" },
      take: 500,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fileId).toBe("file_1");
  });

  it("deleteByContentHashes：deleteMany in，返回 count", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const database = { claudeFileCache: { deleteMany } } as unknown as Database;

    await expect(
      new PrismaClaudeFileCacheDao({ database }).deleteByContentHashes(["a", "b"]),
    ).resolves.toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({ where: { contentSha256: { in: ["a", "b"] } } });
  });

  it("deleteByContentHashes：空数组短路，不发查询", async () => {
    const deleteMany = vi.fn();
    const database = { claudeFileCache: { deleteMany } } as unknown as Database;

    await expect(
      new PrismaClaudeFileCacheDao({ database }).deleteByContentHashes([]),
    ).resolves.toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
