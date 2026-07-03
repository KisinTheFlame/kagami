import { contractUrl } from "@kagami/http/url";
import { agentApiContract } from "@kagami/agent-api/contract";
import { SchedulerTaskListResponseSchema } from "@kagami/agent-api/scheduler";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import { createSchemaQueryOptions } from "@/lib/query";

const QUERY_KEY = ["scheduler", "tasks"] as const;

export function useSchedulerTasks() {
  const queryOptions = createSchemaQueryOptions({
    queryKey: QUERY_KEY,
    path: contractUrl(agentApiContract.listSchedulerTasks),
    schema: SchedulerTaskListResponseSchema,
  });

  return useQuery({
    ...queryOptions,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });
}

export function useTriggerSchedulerTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      await apiPost(contractUrl(agentApiContract.triggerSchedulerTask, { params: { name } }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
