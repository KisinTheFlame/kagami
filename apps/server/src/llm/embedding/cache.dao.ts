import type { EmbeddingTaskType } from "./types.js";

export type EmbeddingCacheKey = {
  provider: "google";
  model: string;
  taskType: EmbeddingTaskType;
  outputDimensionality: number;
  textHash: string;
};

export type EmbeddingCacheRecord = EmbeddingCacheKey & {
  text: string;
  embedding: number[];
  createdAt: Date;
};

export interface EmbeddingCacheDao {
  findByKey(input: EmbeddingCacheKey): Promise<EmbeddingCacheRecord | null>;
  save(input: EmbeddingCacheKey & { text: string; embedding: number[] }): Promise<void>;
}
