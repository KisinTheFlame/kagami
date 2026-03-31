import {
  type StoryListQuery,
  type StoryListResponse,
  StoryListResponseSchema,
} from "@kagami/shared/schemas/story";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { buildQueryString } from "@/lib/search-params";

type StoryListFilters = Omit<StoryListQuery, "page" | "pageSize">;

export function useStoryList(
  page: number,
  pageSize: number,
  filters: StoryListFilters,
): UseQueryResult<StoryListResponse, Error> {
  return useQuery({
    queryKey: ["story", page, pageSize, filters],
    queryFn: async () => {
      const query = buildQueryString({
        page: String(page),
        pageSize: String(pageSize),
        query: filters.query,
      });

      const response = await apiFetch<unknown>(`/story/query?${query}`);
      return StoryListResponseSchema.parse(response);
    },
  });
}
