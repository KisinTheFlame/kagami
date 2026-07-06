import { useQuery } from "@tanstack/react-query";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";
import { ossConsoleClient } from "@/lib/rpc";

export function useOssStats() {
  return useQuery(
    createSchemaQueryOptions({
      queryKey: queryKeys.ossObject.stats(),
      queryFn: () => ossConsoleClient.getStats({}),
    }),
  );
}
