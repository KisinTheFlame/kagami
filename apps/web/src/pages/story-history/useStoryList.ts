import {
  type StoryListQuery,
  type StoryListResponse,
  StoryListResponseSchema,
} from "@kagami/shared/schemas/story";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";

type StoryListFilters = Omit<StoryListQuery, "page" | "pageSize">;

export function useStoryList(page: number, pageSize: number, filters: StoryListFilters) {
  const params = {
    page: String(page),
    pageSize: String(pageSize),
    query: filters.query,
  } satisfies Record<string, string | undefined>;

  return useQuery(
    createHistoryListQueryOptions<
      StoryListResponse,
      ReturnType<typeof queryKeys.story.historyList>
    >({
      queryKey: queryKeys.story.historyList(params),
      path: "/story/query",
      schema: StoryListResponseSchema,
      params,
    }),
  );
}
