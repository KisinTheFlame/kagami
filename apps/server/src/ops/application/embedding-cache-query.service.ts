import {
  type EmbeddingCacheListQuery,
  type EmbeddingCacheListResponse,
} from "@kagami/shared/schemas/embedding-cache";

export interface EmbeddingCacheQueryService {
  queryList(query: EmbeddingCacheListQuery): Promise<EmbeddingCacheListResponse>;
}
