import { AgentDashboardSnapshotSchema } from "@kagami/shared/schemas/agent-dashboard";
import { useQuery } from "@tanstack/react-query";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";

/**
 * 拉 /agent-dashboard/current 接口取整个 dashboard snapshot，新页面只渲染
 * 里面 root agent 的 recentItems。后端接口暂时复用 dashboard 时代的，等
 * 后续清理底层 schema 时再瘦身。
 */
export function useMainAgentContext() {
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
