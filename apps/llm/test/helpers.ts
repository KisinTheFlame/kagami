import { encodeBlob } from "../src/app/llm-payload-codec.js";
import type { Database } from "../src/infra/db/client.js";
import type {
  LlmBlobDao,
  LlmBlobGcCandidate,
  ResolveBlobIdsResult,
} from "../src/infra/llm-blob.dao.js";

/**
 * `llm_blob` 的内存实现：内容寻址、续期、GC 候选筛选都按真实语义来，这样「连续两轮只新增
 * 1 个 blob」「重试新增 0 个」这类断言测的是行为而不是 mock 的返回值。
 */
export class InMemoryLlmBlobDao implements LlmBlobDao {
  private readonly rows = new Map<
    number,
    { id: number; hashKey: string; raw: Buffer; storedBytes: number; lastUsedAt: Date }
  >();
  private readonly idByHash = new Map<string, number>();
  private nextId = 1;

  /** 测试直接读：当前库里有多少个唯一 blob。 */
  public get size(): number {
    return this.rows.size;
  }

  public get liveIds(): number[] {
    return [...this.rows.keys()];
  }

  /** 让某个 blob 看起来很久没被引用过，用于驱动 GC 的宽限窗口分支。 */
  public setLastUsedAt(id: number, lastUsedAt: Date): void {
    const row = this.rows.get(id);
    if (row) {
      row.lastUsedAt = lastUsedAt;
    }
  }

  public resolveIds(raws: readonly Buffer[]): Promise<ResolveBlobIdsResult> {
    let insertedCount = 0;
    let insertedStoredBytes = 0;

    const ids = raws.map(raw => {
      const encoded = encodeBlob(raw);
      const hashKey = encoded.hash.toString("hex");
      const existing = this.idByHash.get(hashKey);
      if (existing !== undefined) {
        const row = this.rows.get(existing);
        if (row) {
          row.lastUsedAt = new Date();
        }

        return existing;
      }

      const id = this.nextId++;
      this.rows.set(id, {
        id,
        hashKey,
        raw,
        storedBytes: encoded.bytes.length,
        lastUsedAt: new Date(),
      });
      this.idByHash.set(hashKey, id);
      insertedCount += 1;
      insertedStoredBytes += encoded.bytes.length;

      return id;
    });

    return Promise.resolve({ ids, insertedCount, insertedStoredBytes });
  }

  public loadMany(ids: readonly number[]): Promise<Map<number, Buffer>> {
    const result = new Map<number, Buffer>();
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row) {
        result.set(id, row.raw);
      }
    }

    return Promise.resolve(result);
  }

  public listGcCandidates(input: {
    afterId: number;
    usedBefore: Date;
    limit: number;
  }): Promise<LlmBlobGcCandidate[]> {
    const candidates = [...this.rows.values()]
      .filter(row => row.id > input.afterId && row.lastUsedAt < input.usedBefore)
      .sort((left, right) => left.id - right.id)
      .slice(0, input.limit)
      .map(row => ({ id: row.id, storedBytes: row.storedBytes }));

    return Promise.resolve(candidates);
  }

  public deleteByIds(ids: readonly number[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row) {
        this.rows.delete(id);
        this.idByHash.delete(row.hashKey);
        deleted += 1;
      }
    }

    return Promise.resolve(deleted);
  }
}

type ChatCallRow = Record<string, unknown> & { id: number };

/**
 * `llm_chat_call` 那张表的内存替身：只实现 DAO 真正用到的 create / findUnique / findMany。
 * `create` 把 data 原样收下，因此断言可以直接看落库的列（含 request_skeleton / message_refs）。
 */
export class InMemoryChatCallTable {
  public readonly created: Record<string, unknown>[] = [];
  private readonly rows: ChatCallRow[] = [];
  private nextId = 1;

  public asDatabase(): Database {
    return {
      llmChatCall: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          this.created.push(data);
          const row: ChatCallRow = {
            scene: null,
            extension: null,
            responsePayload: null,
            nativeResponsePayload: null,
            error: null,
            nativeError: null,
            latencyMs: null,
            createdAt: new Date(0),
            ...data,
            id: this.nextId++,
          };
          this.rows.push(row);

          return Promise.resolve(row);
        },
        findUnique: ({ where }: { where: { id: number } }) =>
          Promise.resolve(this.rows.find(row => row.id === where.id) ?? null),
        findMany: ({ where, take }: { where?: { id?: { gt: number } }; take?: number }) => {
          const afterId = where?.id?.gt ?? 0;
          const matched = this.rows
            .filter(row => row.id > afterId)
            .sort((left, right) => left.id - right.id);

          return Promise.resolve(take === undefined ? matched : matched.slice(0, take));
        },
      },
    } as unknown as Database;
  }
}
