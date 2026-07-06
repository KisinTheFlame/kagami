import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";
import { ossConsoleClient } from "@/lib/rpc";

export type OssObjectListFilters = {
  mime?: string;
};

export function useOssObjectList(page: number, pageSize: number, filters: OssObjectListFilters) {
  const params = {
    page,
    pageSize,
    mime: filters.mime,
  };

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.ossObject.historyList(params),
      queryFn: () => ossConsoleClient.queryObjects(params),
    }),
  );
}
