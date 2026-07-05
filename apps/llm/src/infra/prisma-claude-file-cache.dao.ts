import type { Database } from "@kagami/persistence/db/client";
import type { ClaudeFileCacheDao, ClaudeFileCacheRecord } from "@kagami/llm-client";

/**
 * claude-code 图片 File API 缓存的 Prisma 实现：sha256 → 已上传 Anthropic file_id。
 * 镜像 PrismaEmbeddingCacheDao 的 port/impl 拆分。save 用 upsert 保证并发/重启下幂等。
 */
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

    return {
      contentSha256: row.contentSha256,
      fileId: row.fileId,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
    };
  }

  public async save(input: ClaudeFileCacheRecord): Promise<void> {
    await this.database.claudeFileCache.upsert({
      where: { contentSha256: input.contentSha256 },
      create: {
        contentSha256: input.contentSha256,
        fileId: input.fileId,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
      // 同一内容 sha256 理应稳定映射同一 file_id；并发下若已存在则以最新写入覆盖（幂等）。
      update: {
        fileId: input.fileId,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
    });
  }
}
