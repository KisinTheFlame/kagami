import { type InnerThoughtOutcome } from "@kagami/console-api/inner-thought";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";
import { consoleClient } from "@/lib/rpc";

export function useInnerThoughtList(
  page: number,
  pageSize: number,
  outcome: InnerThoughtOutcome | undefined,
) {
  const params = {
    page,
    pageSize,
    outcome,
  };

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.innerThought.historyList(params),
      queryFn: () => consoleClient.queryInnerThoughts(params),
    }),
  );
}
