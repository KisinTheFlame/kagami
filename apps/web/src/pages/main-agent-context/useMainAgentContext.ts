import { contractUrl } from "@kagami/http/url";
import { agentApiContract } from "@kagami/agent-api/contract";
import { MainAgentContextSnapshotSchema } from "@kagami/agent-api/main-agent-context";
import { useQuery } from "@tanstack/react-query";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";

export function useMainAgentContext() {
  const queryOptions = createSchemaQueryOptions({
    queryKey: queryKeys.mainAgentContext.recent(),
    path: contractUrl(agentApiContract.getRecentMainAgentContext),
    schema: MainAgentContextSnapshotSchema,
  });

  return useQuery({
    ...queryOptions,
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });
}
