import type { Database } from "@kagami/persistence/db/client";
import type {
  ClaudeFileCacheDao,
  ClaudeFileCacheRecord,
  ClaudeFileCacheSaveInput,
} from "@kagami/llm-client";

/**
 * claude-code 图片 File API 缓存的 Prisma 实现：sha256 → 已上传 Anthropic file_id。
 * 镜像 PrismaEmbeddingCacheDao 的 port/impl 拆分。save 用 upsert 保证并发/重启下幂等。
 * findIdle / touch / deleteByContentHashes 支撑按最近使用时间的 GC（#433）。
 */

// 命中刷新 last_used_at 的节流窗：仅当距上次刷新超过它才真写，压掉热路径写放大。6h 远小于
// 3 天 GC 粒度，last_used_at 至多滞后真实使用 6h，对 idle 判据无影响。
const TOUCH_THROTTLE_MS = 6 * 60 * 60 * 1000;

type ClaudeFileCacheRow = {
  contentSha256: string;
  fileId: string;
  mimeType: string;
  sizeBytes: number;
  lastUsedAt: Date;
};

function toRecord(row: ClaudeFileCacheRow): ClaudeFileCacheRecord {
  return {
    contentSha256: row.contentSha256,
    fileId: row.fileId,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    lastUsedAt: row.lastUsedAt,
  };
}

export class PrismaClaudeFileCacheDao implements ClaudeFileCacheDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async findByHash(contentSha256: string): Promise<ClaudeFileCacheRecord | null> {
    const row = await this.database.claudeFileCache.findUnique({
      where: { contentSha256 },
    });

    if (!row) {
      return null;
    }

    return toRecord(row);
  }

  public async save(input: ClaudeFileCacheSaveInput): Promise<void> {
    await this.database.claudeFileCache.upsert({
      where: { contentSha256: input.contentSha256 },
      // last_used_at / created_at 由 @default(now()) 填（新上传即最近使用）。
      create: {
        contentSha256: input.contentSha256,
        fileId: input.fileId,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
      // 同一内容 sha256 理应稳定映射同一 file_id；并发下若已存在则以最新写入覆盖（幂等）。
      // 不动 last_used_at：命中刷新走 touch，这里是"上传后写缓存"路径。
      update: {
        fileId: input.fileId,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
    });
  }

  public async touch(contentSha256: string): Promise<void> {
    const throttleCutoff = new Date(Date.now() - TOUCH_THROTTLE_MS);
    // 条件更新：仅当 last_used_at 早于节流窗才真写；否则 where 不匹配、0 行影响（indexed，极廉）。
    await this.database.claudeFileCache.updateMany({
      where: { contentSha256, lastUsedAt: { lt: throttleCutoff } },
      data: { lastUsedAt: new Date() },
    });
  }

  public async findIdle(params: { cutoff: Date; limit: number }): Promise<ClaudeFileCacheRecord[]> {
    const rows = await this.database.claudeFileCache.findMany({
      where: { lastUsedAt: { lt: params.cutoff } },
      orderBy: { lastUsedAt: "asc" },
      take: params.limit,
    });
    return rows.map(toRecord);
  }

  public async deleteByContentHashes(contentSha256: readonly string[]): Promise<number> {
    if (contentSha256.length === 0) {
      return 0;
    }
    const result = await this.database.claudeFileCache.deleteMany({
      where: { contentSha256: { in: [...contentSha256] } },
    });
    return result.count;
  }
}
