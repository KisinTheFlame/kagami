import {
  EmbeddingCacheListResponseSchema,
  type EmbeddingCacheListQuery,
} from "@kagami/shared/schemas/embedding-cache";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { buildQueryString } from "@/lib/search-params";

type EmbeddingCacheListFilters = Omit<EmbeddingCacheListQuery, "page" | "pageSize">;

export function useEmbeddingCacheList(
  page: number,
  pageSize: number,
  filters: EmbeddingCacheListFilters,
) {
  return useQuery({
    queryKey: ["embedding-cache", page, pageSize, filters],
    queryFn: async () => {
      const query = buildQueryString({
        page: String(page),
        pageSize: String(pageSize),
        provider: filters.provider,
        model: filters.model,
        taskType: filters.taskType,
        outputDimensionality: filters.outputDimensionality,
        textHash: filters.textHash,
        text: filters.text,
        startAt: filters.startAt,
        endAt: filters.endAt,
      });

      const response = await apiFetch<unknown>(`/embedding-cache/query?${query}`);
      return EmbeddingCacheListResponseSchema.parse(response);
    },
  });
}
