import type { Database } from "@kagami/server-core/db/client";
import type { ImageAssetDao, ImageAssetRecord, UpsertImageAssetItem } from "../image-asset.dao.js";

type PrismaImageAssetDaoDeps = {
  database: Database;
};

export class PrismaImageAssetDao implements ImageAssetDao {
  private readonly database: Database;

  public constructor({ database }: PrismaImageAssetDaoDeps) {
    this.database = database;
  }

  public async findByFileId(fileId: string): Promise<ImageAssetRecord | null> {
    const row = await this.database.imageAsset.findUnique({
      where: { fileId },
      select: { resid: true, description: true },
    });
    return row ?? null;
  }

  public async upsert(item: UpsertImageAssetItem): Promise<void> {
    await this.database.imageAsset.upsert({
      where: { fileId: item.fileId },
      create: {
        fileId: item.fileId,
        resid: item.resid,
        description: item.description,
        mime: item.mime,
      },
      update: {
        resid: item.resid,
        description: item.description,
        mime: item.mime,
      },
    });
  }
}
