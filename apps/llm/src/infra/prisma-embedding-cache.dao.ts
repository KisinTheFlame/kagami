import type { Database } from "@kagami/persistence/db/client";
import type {
  EmbeddingCacheDao,
  EmbeddingCacheKey,
  EmbeddingCacheRecord,
} from "@kagami/llm-client/embedding";

export class PrismaEmbeddingCacheDao implements EmbeddingCacheDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async findByKey(input: EmbeddingCacheKey): Promise<EmbeddingCacheRecord | null> {
    const row = await this.database.embeddingCache.findUnique({
      where: {
        provider_model_taskType_outputDimensionality_textHash: {
          provider: input.provider,
          model: input.model,
          taskType: input.taskType,
          outputDimensionality: input.outputDimensionality,
          textHash: input.textHash,
        },
      },
    });

    if (!row) {
      return null;
    }

    // SQLite 不支持标量数组，embedding 以 JSON 字符串存储，读取时反序列化。
    const embedding = deserializeEmbedding(row.embedding);
    if (embedding === null) {
      // 缓存行损坏（JSON 坏 / 含非有限数值）：当未命中处理，让上层重算并覆盖写回，
      // 而不是把 [] 或 [NaN,...] 这种坏向量喂给下游相似度计算。
      return null;
    }

    return {
      provider: row.provider as EmbeddingCacheRecord["provider"],
      model: row.model,
      taskType: row.taskType as EmbeddingCacheRecord["taskType"],
      outputDimensionality: row.outputDimensionality,
      text: row.text,
      textHash: row.textHash,
      embedding,
      createdAt: row.createdAt,
    };
  }

  public async save(
    input: EmbeddingCacheKey & { text: string; embedding: number[] },
  ): Promise<void> {
    await this.database.embeddingCache.upsert({
      where: {
        provider_model_taskType_outputDimensionality_textHash: {
          provider: input.provider,
          model: input.model,
          taskType: input.taskType,
          outputDimensionality: input.outputDimensionality,
          textHash: input.textHash,
        },
      },
      create: {
        provider: input.provider,
        model: input.model,
        taskType: input.taskType,
        outputDimensionality: input.outputDimensionality,
        text: input.text,
        textHash: input.textHash,
        embedding: serializeEmbedding(input.embedding),
      },
      update: {
        text: input.text,
        embedding: serializeEmbedding(input.embedding),
      },
    });
  }
}

function serializeEmbedding(embedding: number[]): string {
  return JSON.stringify(embedding);
}

/**
 * 反序列化 embedding。JSON 损坏、非数组、或含非有限数值（NaN/Infinity）时返回 null，
 * 让调用方把这行当缓存未命中处理并重算，杜绝坏向量静默穿透到相似度计算。
 */
function deserializeEmbedding(value: string): number[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  // 按原始元素严判，不做 Number() 强转：Number(null)/Number("") 会静默变 0，而
  // JSON.stringify([NaN]) 存的正是 null——强转会让坏分量伪装成合法 0 穿透下去。
  if (parsed.some(component => typeof component !== "number" || !Number.isFinite(component))) {
    return null;
  }

  return parsed as number[];
}
