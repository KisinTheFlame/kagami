import { describe, expect, it, vi } from "vitest";
import type { Database } from "@kagami/persistence/db/client";
import { PrismaImageAssetDao } from "../../src/napcat/infra/impl/image-asset.impl.dao.js";

describe("PrismaImageAssetDao", () => {
  it("findByFileId returns the stored resid + description", async () => {
    const findUnique = vi.fn().mockResolvedValue({ resid: "res-3", description: "一只猫" });
    const database = { imageAsset: { findUnique } } as unknown as Database;
    const dao = new PrismaImageAssetDao({ database });

    await expect(dao.findByFileId("MD5.png")).resolves.toEqual({
      resid: "res-3",
      description: "一只猫",
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { fileId: "MD5.png" },
      select: { resid: true, description: true },
    });
  });

  it("findByFileId returns null when the file is unknown", async () => {
    const database = {
      imageAsset: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Database;

    await expect(new PrismaImageAssetDao({ database }).findByFileId("nope")).resolves.toBeNull();
  });

  it("upsert keys on file_id with matching create + update branches", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const database = { imageAsset: { upsert } } as unknown as Database;
    const dao = new PrismaImageAssetDao({ database });

    await dao.upsert({ fileId: "MD5.png", resid: "res-9", description: "图" });

    expect(upsert).toHaveBeenCalledWith({
      where: { fileId: "MD5.png" },
      create: { fileId: "MD5.png", resid: "res-9", description: "图" },
      update: { resid: "res-9", description: "图" },
    });
  });
});
