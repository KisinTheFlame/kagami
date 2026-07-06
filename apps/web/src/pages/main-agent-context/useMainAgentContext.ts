import { useQuery } from "@tanstack/react-query";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";
import { agentClient } from "@/lib/rpc";

export function useMainAgentContext() {
  const queryOptions = createSchemaQueryOptions({
    queryKey: queryKeys.mainAgentContext.recent(),
    queryFn: () => agentClient.getRecentMainAgentContext({}),
  });

  return useQuery({
    ...queryOptions,
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });
}
