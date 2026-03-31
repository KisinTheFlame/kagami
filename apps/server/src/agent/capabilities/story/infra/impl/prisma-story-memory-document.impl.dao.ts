import * as Prisma from "../../../../../generated/prisma/internal/prismaNamespace.js";
import type { Database } from "../../../../../db/client.js";
import type { StoryMemoryDocumentDao } from "../story-memory-document.dao.js";
import type { StoryMemoryDocumentHit, StoryMemoryDocumentKind } from "../../domain/story.js";

export class PrismaStoryMemoryDocumentDao implements StoryMemoryDocumentDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async replaceForStory(input: {
    storyId: string;
    documents: Array<{
      kind: StoryMemoryDocumentKind;
      content: string;
      embeddingModel: string;
      embeddingDim: number;
      normalizedEmbedding: number[];
    }>;
  }): Promise<void> {
    await this.database.$transaction(async tx => {
      await tx.storyMemoryDocument.deleteMany({
        where: {
          storyId: input.storyId,
        },
      });

      for (const document of input.documents) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "story_memory_document" (
            "story_id",
            "kind",
            "content",
            "embedding_model",
            "embedding_dim",
            "embedding",
            "created_at",
            "updated_at"
          )
          VALUES (
            ${input.storyId},
            ${document.kind},
            ${document.content},
            ${document.embeddingModel},
            ${document.embeddingDim},
            ${toVectorLiteral(document.normalizedEmbedding)}::vector,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `);
      }
    });
  }

  public async searchSimilar(input: {
    queryEmbedding: number[];
    topK: number;
  }): Promise<StoryMemoryDocumentHit[]> {
    const rows = await this.database.$queryRaw<Array<RawStoryMemoryDocumentHit>>(Prisma.sql`
      SELECT
        "id" AS "documentId",
        "story_id" AS "storyId",
        "kind" AS "kind",
        "content" AS "content",
        1 - ("embedding" <=> ${toVectorLiteral(input.queryEmbedding)}::vector) AS "score"
      FROM "story_memory_document"
      WHERE "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${toVectorLiteral(input.queryEmbedding)}::vector ASC
      LIMIT ${Math.max(1, input.topK)}
    `);

    return rows.map(row => ({
      documentId: row.documentId,
      storyId: row.storyId,
      kind: row.kind,
      content: row.content,
      score: Number(row.score),
    }));
  }
}

type RawStoryMemoryDocumentHit = {
  documentId: number;
  storyId: string;
  kind: StoryMemoryDocumentKind;
  content: string;
  score: number | string;
};

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
