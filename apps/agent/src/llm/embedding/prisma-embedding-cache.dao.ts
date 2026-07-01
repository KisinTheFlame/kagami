import type { Database } from "@kagami/persistence/db/client";
import type { EmbeddingCacheDao, EmbeddingCacheKey, EmbeddingCacheRecord } from "./cache.dao.js";

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

    return {
      provider: row.provider as EmbeddingCacheRecord["provider"],
      model: row.model,
      taskType: row.taskType as EmbeddingCacheRecord["taskType"],
      outputDimensionality: row.outputDimensionality,
      text: row.text,
      textHash: row.textHash,
      // SQLite 不支持标量数组，embedding 以 JSON 字符串存储，读取时反序列化。
      embedding: deserializeEmbedding(row.embedding),
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

function deserializeEmbedding(value: string): number[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map(item => Number(item));
}
