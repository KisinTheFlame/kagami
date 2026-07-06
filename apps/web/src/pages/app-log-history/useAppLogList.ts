import { type AppLogListQuery } from "@kagami/console-api/app-log";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";
import { consoleClient } from "@/lib/rpc";

type AppLogListFilters = Omit<AppLogListQuery, "page" | "pageSize">;

export function useAppLogList(page: number, pageSize: number, filters: AppLogListFilters) {
  const params = {
    page,
    pageSize,
    level: filters.level,
    traceId: filters.traceId,
    message: filters.message,
    source: filters.source,
    startAt: filters.startAt,
    endAt: filters.endAt,
  };

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.appLog.historyList(params),
      queryFn: () => consoleClient.queryAppLogs(params),
    }),
  );
}
