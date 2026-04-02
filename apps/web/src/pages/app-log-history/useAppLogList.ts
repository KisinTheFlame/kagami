import { AppLogListResponseSchema, type AppLogListQuery } from "@kagami/shared/schemas/app-log";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";

type AppLogListFilters = Omit<AppLogListQuery, "page" | "pageSize">;

export function useAppLogList(page: number, pageSize: number, filters: AppLogListFilters) {
  const params = {
    page: String(page),
    pageSize: String(pageSize),
    level: filters.level,
    traceId: filters.traceId,
    message: filters.message,
    source: filters.source,
    startAt: filters.startAt,
    endAt: filters.endAt,
  } satisfies Record<string, string | undefined>;

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.appLog.historyList(params),
      path: "/app-log/query",
      schema: AppLogListResponseSchema,
      params,
    }),
  );
}
