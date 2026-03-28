import type { EmbeddingCacheListQuery, EmbeddingCacheListResponse } from "@kagami/shared";

export interface EmbeddingCacheQueryService {
  queryList(query: EmbeddingCacheListQuery): Promise<EmbeddingCacheListResponse>;
}
