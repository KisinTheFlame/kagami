import {
  NapcatEventListResponseSchema,
  type NapcatEventListQuery,
} from "@kagami/shared/schemas/napcat-event";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";

type NapcatEventListFilters = Omit<NapcatEventListQuery, "page" | "pageSize">;

export function useNapcatEventList(
  page: number,
  pageSize: number,
  filters: NapcatEventListFilters,
) {
  const params = {
    page: String(page),
    pageSize: String(pageSize),
    postType: filters.postType,
    messageType: filters.messageType,
    userId: filters.userId,
    startAt: filters.startAt,
    endAt: filters.endAt,
  } satisfies Record<string, string | undefined>;

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.napcatEvent.historyList(params),
      path: "/napcat-event/query",
      schema: NapcatEventListResponseSchema,
      params,
    }),
  );
}
