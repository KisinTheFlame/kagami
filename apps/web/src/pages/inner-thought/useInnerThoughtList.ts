import { contractUrl } from "@kagami/http/url";
import { consoleApiContract } from "@kagami/console-api/contract";
import {
  InnerThoughtListResponseSchema,
  type InnerThoughtOutcome,
} from "@kagami/console-api/inner-thought";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";

export function useInnerThoughtList(
  page: number,
  pageSize: number,
  outcome: InnerThoughtOutcome | undefined,
) {
  const params = {
    page: String(page),
    pageSize: String(pageSize),
    outcome,
  } satisfies Record<string, string | undefined>;

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.innerThought.historyList(params),
      path: contractUrl(consoleApiContract.queryInnerThoughts),
      schema: InnerThoughtListResponseSchema,
      params,
    }),
  );
}
