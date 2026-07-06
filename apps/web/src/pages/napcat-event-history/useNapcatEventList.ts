import { type NapcatEventListQuery } from "@kagami/console-api/napcat-event";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";
import { consoleClient } from "@/lib/rpc";

type NapcatEventListFilters = Omit<NapcatEventListQuery, "page" | "pageSize">;

export function useNapcatEventList(
  page: number,
  pageSize: number,
  filters: NapcatEventListFilters,
) {
  const params = {
    page,
    pageSize,
    postType: filters.postType,
    messageType: filters.messageType,
    userId: filters.userId,
    startAt: filters.startAt,
    endAt: filters.endAt,
  };

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.napcatEvent.historyList(params),
      queryFn: () => consoleClient.queryNapcatEvents(params),
    }),
  );
}
