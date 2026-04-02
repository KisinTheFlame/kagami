import type { Database } from "../../db/client.js";
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
      embedding: row.embedding,
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
        embedding: input.embedding,
      },
      update: {
        text: input.text,
        embedding: input.embedding,
      },
    });
  }
}
