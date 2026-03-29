import {
  AgentDashboardSnapshotSchema,
  type AgentDashboardSnapshot,
} from "@kagami/shared/schemas/agent-dashboard";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export function useAgentDashboardSnapshot() {
  return useQuery<AgentDashboardSnapshot>({
    queryKey: ["agent-dashboard", "current"],
    queryFn: async () => {
      const response = await apiFetch<unknown>("/agent-dashboard/current");
      return AgentDashboardSnapshotSchema.parse(response);
    },
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
