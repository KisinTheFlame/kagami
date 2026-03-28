import { AppLogger } from "../../../../logger/logger.js";
import type { EmbeddingClient } from "../../../../llm/embedding/client.js";
import type { NapcatGroupMessageChunkDao } from "../../../../napcat/dao/napcat-group-message-chunk.dao.js";

const logger = new AppLogger({ source: "rag.indexer" });

export class GroupMessageChunkIndexer {
  private readonly chunkDao: NapcatGroupMessageChunkDao;
  private readonly embeddingClient: EmbeddingClient;
  private readonly outputDimensionality: number;
  private processing = false;
  private readonly pendingChunkIds: number[] = [];

  public constructor({
    chunkDao,
    embeddingClient,
    outputDimensionality,
  }: {
    chunkDao: NapcatGroupMessageChunkDao;
    embeddingClient: EmbeddingClient;
    outputDimensionality: number;
  }) {
    this.chunkDao = chunkDao;
    this.embeddingClient = embeddingClient;
    this.outputDimensionality = outputDimensionality;
  }

  public enqueue(chunkId: number): void {
    this.pendingChunkIds.push(chunkId);
    if (!this.processing) {
      void this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.pendingChunkIds.length > 0) {
      const chunkId = this.pendingChunkIds.shift();
      if (!chunkId) {
        continue;
      }

      await this.processChunk(chunkId);
    }

    this.processing = false;
  }

  private async processChunk(chunkId: number): Promise<void> {
    const chunk = await this.chunkDao.findById(chunkId);
    if (!chunk || chunk.status !== "pending") {
      return;
    }

    const content = chunk.content.trim();
    if (content.length === 0) {
      await this.chunkDao.markFailed({
        id: chunkId,
        errorMessage: "Chunk content is empty",
      });
      return;
    }

    try {
      const response = await this.embeddingClient.embed({
        content,
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: this.outputDimensionality,
      });

      await this.chunkDao.markIndexed({
        id: chunkId,
        embeddingModel: response.model,
        embeddingDim: response.embedding.length,
        normalizedEmbedding: normalizeEmbedding(response.embedding),
        indexedAt: new Date(),
      });
    } catch (error) {
      logger.errorWithCause("Failed to index group message chunk", error, {
        event: "rag.indexer.chunk_failed",
        chunkId,
      });
      await this.chunkDao.markFailed({
        id: chunkId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function normalizeEmbedding(embedding: number[]): number[] {
  const sumSquares = embedding.reduce((sum, value) => sum + value * value, 0);
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) {
    return embedding;
  }

  return embedding.map(value => value / norm);
}
