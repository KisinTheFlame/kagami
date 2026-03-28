import { Prisma } from "@prisma/client";
import type { Database } from "../../../db/client.js";
import type {
  InsertNapcatGroupMessageChunkItem,
  NapcatGroupMessageChunkDao,
  NapcatGroupMessageChunkItem,
  NapcatGroupMessageChunkSearchHit,
} from "../napcat-group-message-chunk.dao.js";

type PrismaNapcatGroupMessageChunkDaoDeps = {
  database: Database;
};

export class PrismaNapcatGroupMessageChunkDao implements NapcatGroupMessageChunkDao {
  private readonly database: Database;

  public constructor({ database }: PrismaNapcatGroupMessageChunkDaoDeps) {
    this.database = database;
  }

  public async insert(item: InsertNapcatGroupMessageChunkItem): Promise<number> {
    const rows = await this.database.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      INSERT INTO "napcat_group_message_chunk" (
        "source_message_id",
        "group_id",
        "chunk_index",
        "content",
        "status",
        "embedding_model",
        "embedding_dim",
        "error_message",
        "indexed_at"
      )
      VALUES (
        ${item.sourceMessageId},
        ${item.groupId},
        ${item.chunkIndex},
        ${item.content},
        ${item.status},
        ${item.embeddingModel},
        ${item.embeddingDim},
        ${item.errorMessage},
        ${item.indexedAt ?? null}
      )
      RETURNING "id"
    `);

    return rows[0]?.id ?? 0;
  }

  public async findById(id: number): Promise<NapcatGroupMessageChunkItem | null> {
    const rows = await this.database.$queryRaw<RawChunkRow[]>(Prisma.sql`
      SELECT
        "id",
        "source_message_id" AS "sourceMessageId",
        "group_id" AS "groupId",
        "chunk_index" AS "chunkIndex",
        "content",
        "status",
        "embedding_model" AS "embeddingModel",
        "embedding_dim" AS "embeddingDim",
        "error_message" AS "errorMessage",
        "indexed_at" AS "indexedAt",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "napcat_group_message_chunk"
      WHERE "id" = ${id}
      LIMIT 1
    `);

    const row = rows[0];
    return row ? mapRawChunkRow(row) : null;
  }

  public async markIndexed(input: {
    id: number;
    embeddingModel: string;
    embeddingDim: number;
    normalizedEmbedding: number[];
    indexedAt: Date;
  }): Promise<void> {
    await this.database.$executeRaw(Prisma.sql`
      UPDATE "napcat_group_message_chunk"
      SET
        "status" = 'indexed',
        "embedding_model" = ${input.embeddingModel},
        "embedding_dim" = ${input.embeddingDim},
        "embedding" = ${toVectorLiteral(input.normalizedEmbedding)}::vector,
        "error_message" = NULL,
        "indexed_at" = ${input.indexedAt},
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.id}
    `);
  }

  public async markFailed(input: { id: number; errorMessage: string }): Promise<void> {
    await this.database.$executeRaw(Prisma.sql`
      UPDATE "napcat_group_message_chunk"
      SET
        "status" = 'failed',
        "error_message" = ${input.errorMessage},
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.id}
    `);
  }

  public async searchSimilar(input: {
    groupId: string;
    queryEmbedding: number[];
    topK: number;
  }): Promise<NapcatGroupMessageChunkSearchHit[]> {
    const rows = await this.database.$queryRaw<RawChunkSearchRow[]>(Prisma.sql`
      SELECT
        "id" AS "chunkId",
        "source_message_id" AS "sourceMessageId",
        "group_id" AS "groupId",
        "content" AS "content",
        1 - ("embedding" <=> ${toVectorLiteral(input.queryEmbedding)}::vector) AS "score"
      FROM "napcat_group_message_chunk"
      WHERE "group_id" = ${input.groupId}
        AND "status" = 'indexed'
        AND "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${toVectorLiteral(input.queryEmbedding)}::vector ASC
      LIMIT ${input.topK}
    `);

    return rows.map(row => ({
      chunkId: row.chunkId,
      sourceMessageId: row.sourceMessageId,
      groupId: row.groupId,
      content: row.content,
      score: Number(row.score),
    }));
  }
}

type RawChunkRow = {
  id: number;
  sourceMessageId: number;
  groupId: string;
  chunkIndex: number;
  content: string;
  status: "pending" | "indexed" | "failed";
  embeddingModel: string | null;
  embeddingDim: number | null;
  errorMessage: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawChunkSearchRow = {
  chunkId: number;
  sourceMessageId: number;
  groupId: string;
  content: string;
  score: number | string;
};

function mapRawChunkRow(row: RawChunkRow): NapcatGroupMessageChunkItem {
  return {
    id: row.id,
    sourceMessageId: row.sourceMessageId,
    groupId: row.groupId,
    chunkIndex: row.chunkIndex,
    content: row.content,
    status: row.status,
    embeddingModel: row.embeddingModel,
    embeddingDim: row.embeddingDim,
    errorMessage: row.errorMessage,
    indexedAt: row.indexedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
