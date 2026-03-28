export type InsertNapcatGroupMessageChunkItem = {
  sourceMessageId: number;
  groupId: string;
  chunkIndex: number;
  content: string;
  status: "pending" | "indexed" | "failed";
  embeddingModel: string | null;
  embeddingDim: number | null;
  errorMessage: string | null;
  indexedAt?: Date | null;
};

export type NapcatGroupMessageChunkItem = {
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

export type NapcatGroupMessageChunkSearchHit = {
  chunkId: number;
  sourceMessageId: number;
  groupId: string;
  content: string;
  score: number;
};

export interface NapcatGroupMessageChunkDao {
  insert(item: InsertNapcatGroupMessageChunkItem): Promise<number>;
  findById(id: number): Promise<NapcatGroupMessageChunkItem | null>;
  markIndexed(input: {
    id: number;
    embeddingModel: string;
    embeddingDim: number;
    normalizedEmbedding: number[];
    indexedAt: Date;
  }): Promise<void>;
  markFailed(input: { id: number; errorMessage: string }): Promise<void>;
  searchSimilar(input: {
    groupId: string;
    queryEmbedding: number[];
    topK: number;
  }): Promise<NapcatGroupMessageChunkSearchHit[]>;
}
