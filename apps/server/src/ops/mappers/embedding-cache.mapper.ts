import type { EmbeddingCacheItem, EmbeddingCacheListResponse } from "@kagami/shared";
import type { EmbeddingCacheListItem as EmbeddingCacheDaoListItem } from "../../llm/dao/embedding-cache.dao.js";

type MapEmbeddingCacheListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: EmbeddingCacheDaoListItem[];
};

export function mapEmbeddingCacheList(
  input: MapEmbeddingCacheListInput,
): EmbeddingCacheListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items.map(mapEmbeddingCacheItem),
  };
}

function mapEmbeddingCacheItem(item: EmbeddingCacheDaoListItem): EmbeddingCacheItem {
  return {
    id: item.id,
    provider: item.provider,
    model: item.model,
    taskType: item.taskType,
    outputDimensionality: item.outputDimensionality,
    text: item.text,
    textHash: item.textHash,
    embeddingPreview: item.embeddingPreview,
    embeddingDim: item.embeddingDim,
    createdAt: item.createdAt.toISOString(),
  };
}
