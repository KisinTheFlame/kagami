import { encodeBlob, decodeBlob, toDbBytes } from "../../app/llm-payload-codec.js";
import type { Database } from "../db/client.js";
import type { LlmBlobDao, LlmBlobGcCandidate, ResolveBlobIdsResult } from "../llm-blob.dao.js";

/**
 * 分块大小：SQLite 的 `IN (...)` 会展开成同样多的绑定变量。现代构建上限是 32766，
 * 500 只是留足余量的保守值——冷启动一次会话有 2000+ 条 message，也只是 5 次往返。
 */
const QUERY_CHUNK_SIZE = 500;

/**
 * 续期节流：`lastUsedAt` 比这个还新就不必再写。稳态下同一批 blob 每轮都被引用，逐次 UPDATE
 * 2000+ 行纯属自残；只有超过这个间隔才批量续一次，代价是宽限窗口要显著大于它（1h vs 10min）。
 */
const TOUCH_INTERVAL_MS = 600_000;

/** Prisma 唯一约束冲突（P2002）。内容寻址下撞它等价于「别人已经插好了」。 */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/** `selectIdsByHash` 的行：id 之外还要 lastUsedAt 才能决定要不要续期。 */
type TouchableRow = {
  id: number;
  lastUsedAt: Date;
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

type PrismaLlmBlobDaoDeps = {
  database: Database;
};

export class PrismaLlmBlobDao implements LlmBlobDao {
  private readonly database: Database;

  public constructor({ database }: PrismaLlmBlobDaoDeps) {
    this.database = database;
  }

  public async resolveIds(raws: readonly Buffer[]): Promise<ResolveBlobIdsResult> {
    if (raws.length === 0) {
      return { ids: [], insertedCount: 0, insertedStoredBytes: 0 };
    }

    // 先在进程内按 hash 去重：同一轮里重复出现的 message（例如相同的空 tool 结果）只查一次、插一次。
    const encodedByHash = new Map<string, ReturnType<typeof encodeBlob>>();
    const hashKeys = raws.map(raw => {
      const encoded = encodeBlob(raw);
      const key = encoded.hash.toString("hex");
      if (!encodedByHash.has(key)) {
        encodedByHash.set(key, encoded);
      }

      return key;
    });

    const found = await this.selectIdsByHash([...encodedByHash.keys()], encodedByHash);
    const idByHash = new Map([...found].map(([key, row]) => [key, row.id]));
    await this.touchStale([...found.values()]);

    const missing = [...encodedByHash.entries()].filter(([key]) => !idByHash.has(key));
    let insertedCount = 0;
    let insertedStoredBytes = 0;
    if (missing.length > 0) {
      for (const batch of chunk(missing, QUERY_CHUNK_SIZE)) {
        try {
          await this.database.llmBlob.createMany({
            data: batch.map(([, encoded]) => ({
              hash: toDbBytes(encoded.hash),
              codec: encoded.codec,
              sizeBytes: encoded.sizeBytes,
              storedBytes: encoded.bytes.length,
              bytes: toDbBytes(encoded.bytes),
            })),
          });
        } catch (error) {
          // 唯一约束 = 另一个调用在「查缺失」与「插入」之间抢先插了同一段内容。内容寻址下
          // 那一行与我们要插的逐字节相同，所以这不是错误，直接吞掉、由下面的重查拿回 id。
          // 其它错误（磁盘满、schema 不匹配）必须继续抛。
          if (!isUniqueConstraintError(error)) {
            throw error;
          }
        }
      }

      // 重查拿 id：SQLite 上 createMany 不回传自增 id。
      const insertedIds = await this.selectIdsByHash(
        missing.map(([key]) => key),
        encodedByHash,
      );
      for (const [key, row] of insertedIds) {
        idByHash.set(key, row.id);
        const encoded = encodedByHash.get(key);
        if (encoded) {
          insertedCount += 1;
          insertedStoredBytes += encoded.bytes.length;
        }
      }
    }

    const ids = hashKeys.map(key => {
      const id = idByHash.get(key);
      if (id === undefined) {
        throw new Error(`llm_blob 写入后仍取不到 id（hash=${key}）`);
      }

      return id;
    });

    return { ids, insertedCount, insertedStoredBytes };
  }

  public async loadMany(ids: readonly number[]): Promise<Map<number, Buffer>> {
    const result = new Map<number, Buffer>();
    if (ids.length === 0) {
      return result;
    }

    const distinct = [...new Set(ids)];
    for (const batch of chunk(distinct, QUERY_CHUNK_SIZE)) {
      const rows = await this.database.llmBlob.findMany({
        where: { id: { in: batch } },
        select: { id: true, codec: true, bytes: true },
      });
      for (const row of rows) {
        result.set(row.id, decodeBlob({ codec: row.codec, bytes: row.bytes }));
      }
    }

    return result;
  }

  public async listGcCandidates(input: {
    afterId: number;
    usedBefore: Date;
    limit: number;
  }): Promise<LlmBlobGcCandidate[]> {
    return this.database.llmBlob.findMany({
      where: { id: { gt: input.afterId }, lastUsedAt: { lt: input.usedBefore } },
      select: { id: true, storedBytes: true },
      orderBy: { id: "asc" },
      take: input.limit,
    });
  }

  public async deleteByIds(ids: readonly number[]): Promise<number> {
    let deleted = 0;
    for (const batch of chunk(ids, QUERY_CHUNK_SIZE)) {
      const { count } = await this.database.llmBlob.deleteMany({
        where: { id: { in: batch } },
      });
      deleted += count;
    }

    return deleted;
  }

  /** 给复用命中的 blob 续期。只写超过节流间隔的那批，稳态下多数轮次是空操作。 */
  private async touchStale(rows: readonly TouchableRow[]): Promise<void> {
    const threshold = new Date(Date.now() - TOUCH_INTERVAL_MS);
    const staleIds = rows.filter(row => row.lastUsedAt < threshold).map(row => row.id);
    if (staleIds.length === 0) {
      return;
    }

    const now = new Date();
    for (const batch of chunk(staleIds, QUERY_CHUNK_SIZE)) {
      await this.database.llmBlob.updateMany({
        where: { id: { in: batch } },
        data: { lastUsedAt: now },
      });
    }
  }

  private async selectIdsByHash(
    hashKeys: readonly string[],
    encodedByHash: Map<string, ReturnType<typeof encodeBlob>>,
  ): Promise<Map<string, TouchableRow>> {
    const idByHash = new Map<string, TouchableRow>();
    for (const batch of chunk(hashKeys, QUERY_CHUNK_SIZE)) {
      const hashes = batch.map(key => {
        const encoded = encodedByHash.get(key);
        if (!encoded) {
          throw new Error(`内部错误：hash ${key} 不在本次编码集合里`);
        }

        return toDbBytes(encoded.hash);
      });
      const rows = await this.database.llmBlob.findMany({
        where: { hash: { in: hashes } },
        select: { id: true, hash: true, lastUsedAt: true },
      });
      for (const row of rows) {
        idByHash.set(Buffer.from(row.hash).toString("hex"), {
          id: row.id,
          lastUsedAt: row.lastUsedAt,
        });
      }
    }

    return idByHash;
  }
}
