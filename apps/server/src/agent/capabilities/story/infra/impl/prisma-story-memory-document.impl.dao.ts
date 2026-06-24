import type { Database } from "../../../../../db/client.js";
import type {
  StoryMemoryDocumentDao,
  StoryMemoryDocumentIndexMetadata,
} from "../story-memory-document.dao.js";
import type { StoryMemoryDocumentHit, StoryMemoryDocumentKind } from "../../domain/story.js";
import type { HnswVectorIndex } from "../hnsw-vector-index.js";

/** searchSimilar 时在 topK 之外多取一些候选，给 embeddingModel/embeddingDim 过滤留余量。 */
const SEARCH_OVERFETCH = 16;

export class PrismaStoryMemoryDocumentDao implements StoryMemoryDocumentDao {
  private readonly database: Database;
  private readonly vectorIndex: HnswVectorIndex;

  public constructor({
    database,
    vectorIndex,
  }: {
    database: Database;
    vectorIndex: HnswVectorIndex;
  }) {
    this.database = database;
    this.vectorIndex = vectorIndex;
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
    const previousDocuments = await this.database.storyMemoryDocument.findMany({
      where: { storyId: input.storyId },
      select: { id: true },
    });

    const insertedPoints: Array<{ id: number; vector: number[] }> = [];
    await this.database.$transaction(async tx => {
      await tx.storyMemoryDocument.deleteMany({
        where: { storyId: input.storyId },
      });

      for (const document of input.documents) {
        const created = await tx.storyMemoryDocument.create({
          data: {
            storyId: input.storyId,
            kind: document.kind,
            content: document.content,
            embeddingModel: document.embeddingModel,
            embeddingDim: document.embeddingDim,
            // SQLite 不支持向量类型，归一化向量以 JSON 字符串存储；HNSW 索引从这里重建。
            embedding: JSON.stringify(document.normalizedEmbedding),
          },
          select: { id: true },
        });
        insertedPoints.push({ id: created.id, vector: document.normalizedEmbedding });
      }
    });

    // DB 事务提交后再同步内存索引，保证 SQLite 始终是事实来源。索引不在每次写入时落盘——
    // 启动时会从 SQLite 全量重建，磁盘快照只在重建后写一次。
    for (const previous of previousDocuments) {
      this.vectorIndex.remove(previous.id);
    }
    for (const point of insertedPoints) {
      this.vectorIndex.add(point.id, point.vector);
    }
  }

  public async findIndexMetadataByStoryIds(
    storyIds: string[],
  ): Promise<StoryMemoryDocumentIndexMetadata[]> {
    if (storyIds.length === 0) {
      return [];
    }

    const rows = await this.database.storyMemoryDocument.findMany({
      where: {
        storyId: {
          in: storyIds,
        },
      },
      select: {
        storyId: true,
        kind: true,
        embeddingModel: true,
        embeddingDim: true,
      },
    });

    return rows.map(row => ({
      storyId: row.storyId,
      kind: row.kind as StoryMemoryDocumentKind,
      embeddingModel: row.embeddingModel,
      embeddingDim: row.embeddingDim,
    }));
  }

  public async searchSimilar(input: {
    queryEmbedding: number[];
    topK: number;
    embeddingModel: string;
    embeddingDim: number;
  }): Promise<StoryMemoryDocumentHit[]> {
    const topK = Math.max(1, input.topK);
    const hits = this.vectorIndex.search(input.queryEmbedding, topK + SEARCH_OVERFETCH);
    if (hits.length === 0) {
      return [];
    }

    const scoreByDocumentId = new Map(hits.map(hit => [hit.label, hit.score]));
    const rows = await this.database.storyMemoryDocument.findMany({
      where: {
        id: { in: hits.map(hit => hit.label) },
        embeddingModel: input.embeddingModel,
        embeddingDim: input.embeddingDim,
      },
      select: {
        id: true,
        storyId: true,
        kind: true,
        content: true,
      },
    });

    return rows
      .map(row => ({
        documentId: row.id,
        storyId: row.storyId,
        kind: row.kind as StoryMemoryDocumentKind,
        content: row.content,
        score: scoreByDocumentId.get(row.id) ?? 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
