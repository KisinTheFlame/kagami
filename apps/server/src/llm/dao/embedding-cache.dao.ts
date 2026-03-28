import {
  type EmbeddingCacheListQuery,
  type EmbeddingTaskType,
} from "@kagami/shared/schemas/embedding-cache";

export type EmbeddingCacheKey = {
  provider: string;
  model: string;
  taskType: EmbeddingTaskType;
  outputDimensionality: number;
  textHash: string;
};

export type EmbeddingCacheItem = EmbeddingCacheKey & {
  id: number;
  text: string;
  embedding: number[];
  createdAt: Date;
};

export type UpsertEmbeddingCacheItem = EmbeddingCacheKey & {
  text: string;
  embedding: number[];
};

export type QueryEmbeddingCacheListFilterInput = Omit<EmbeddingCacheListQuery, "page" | "pageSize">;
export type QueryEmbeddingCacheListPageInput = EmbeddingCacheListQuery;

export type EmbeddingCacheListItem = {
  id: number;
  provider: string;
  model: string;
  taskType: EmbeddingTaskType;
  outputDimensionality: number;
  text: string;
  textHash: string;
  embeddingPreview: number[];
  embeddingDim: number;
  createdAt: Date;
};

export interface EmbeddingCacheDao {
  findByKey(key: EmbeddingCacheKey): Promise<EmbeddingCacheItem | null>;
  upsert(item: UpsertEmbeddingCacheItem): Promise<void>;
  countByQuery(input: QueryEmbeddingCacheListFilterInput): Promise<number>;
  listByQueryPage(input: QueryEmbeddingCacheListPageInput): Promise<EmbeddingCacheListItem[]>;
}
