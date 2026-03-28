import type { Prisma } from "@prisma/client";
import type { Database } from "../../../db/client.js";
import type {
  EmbeddingCacheDao,
  EmbeddingCacheItem,
  EmbeddingCacheKey,
  EmbeddingCacheListItem,
  QueryEmbeddingCacheListFilterInput,
  QueryEmbeddingCacheListPageInput,
  UpsertEmbeddingCacheItem,
} from "../embedding-cache.dao.js";

type PrismaEmbeddingCacheDaoDeps = {
  database: Database;
};

export class PrismaEmbeddingCacheDao implements EmbeddingCacheDao {
  private readonly database: Database;

  public constructor({ database }: PrismaEmbeddingCacheDaoDeps) {
    this.database = database;
  }

  public async findByKey(key: EmbeddingCacheKey): Promise<EmbeddingCacheItem | null> {
    const item = await this.database.embeddingCache.findUnique({
      where: {
        provider_model_taskType_outputDimensionality_textHash: {
          provider: key.provider,
          model: key.model,
          taskType: key.taskType,
          outputDimensionality: key.outputDimensionality,
          textHash: key.textHash,
        },
      },
    });

    if (!item) {
      return null;
    }

    return {
      id: item.id,
      provider: item.provider,
      model: item.model,
      taskType: item.taskType as EmbeddingCacheItem["taskType"],
      outputDimensionality: item.outputDimensionality,
      text: item.text,
      textHash: item.textHash,
      embedding: item.embedding,
      createdAt: item.createdAt,
    };
  }

  public async upsert(item: UpsertEmbeddingCacheItem): Promise<void> {
    await this.database.embeddingCache.upsert({
      where: {
        provider_model_taskType_outputDimensionality_textHash: {
          provider: item.provider,
          model: item.model,
          taskType: item.taskType,
          outputDimensionality: item.outputDimensionality,
          textHash: item.textHash,
        },
      },
      update: {
        text: item.text,
        embedding: item.embedding,
      },
      create: {
        provider: item.provider,
        model: item.model,
        taskType: item.taskType,
        outputDimensionality: item.outputDimensionality,
        text: item.text,
        textHash: item.textHash,
        embedding: item.embedding,
      },
    });
  }

  public async countByQuery(input: QueryEmbeddingCacheListFilterInput): Promise<number> {
    return this.database.embeddingCache.count({
      where: buildWhereInput(input),
    });
  }

  public async listByQueryPage(
    input: QueryEmbeddingCacheListPageInput,
  ): Promise<EmbeddingCacheListItem[]> {
    const offset = (input.page - 1) * input.pageSize;
    const items = await this.database.embeddingCache.findMany({
      where: buildWhereInput(input),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.pageSize,
      skip: offset,
      select: {
        id: true,
        provider: true,
        model: true,
        taskType: true,
        outputDimensionality: true,
        text: true,
        textHash: true,
        embedding: true,
        createdAt: true,
      },
    });

    return items.map(item => ({
      id: item.id,
      provider: item.provider,
      model: item.model,
      taskType: item.taskType as EmbeddingCacheListItem["taskType"],
      outputDimensionality: item.outputDimensionality,
      text: item.text,
      textHash: item.textHash,
      embeddingPreview: item.embedding.slice(0, 8),
      embeddingDim: item.embedding.length,
      createdAt: item.createdAt,
    }));
  }
}

function buildWhereInput(
  input: QueryEmbeddingCacheListFilterInput,
): Prisma.EmbeddingCacheWhereInput {
  const where: Prisma.EmbeddingCacheWhereInput = {};

  if (input.provider) {
    where.provider = input.provider;
  }
  if (input.model) {
    where.model = input.model;
  }
  if (input.taskType) {
    where.taskType = input.taskType;
  }
  if (input.outputDimensionality) {
    where.outputDimensionality = input.outputDimensionality;
  }
  if (input.textHash) {
    where.textHash = input.textHash;
  }
  if (input.text) {
    where.text = {
      contains: input.text,
      mode: "insensitive",
    };
  }

  const createdAt: Prisma.DateTimeFilter = {};
  if (input.startAt) {
    createdAt.gte = new Date(input.startAt);
  }
  if (input.endAt) {
    createdAt.lte = new Date(input.endAt);
  }
  if (Object.keys(createdAt).length > 0) {
    where.createdAt = createdAt;
  }

  return where;
}
