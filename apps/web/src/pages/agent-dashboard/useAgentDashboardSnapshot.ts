import { AgentDashboardSnapshotSchema } from "@kagami/shared/schemas/agent-dashboard";
import { useQuery } from "@tanstack/react-query";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";

export function useAgentDashboardSnapshot() {
  const queryOptions = createSchemaQueryOptions({
    queryKey: queryKeys.agentDashboard.current(),
    path: "/agent-dashboard/current",
    schema: AgentDashboardSnapshotSchema,
  });

  return useQuery({
    ...queryOptions,
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });
}
