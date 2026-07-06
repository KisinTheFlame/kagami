import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSchemaQueryOptions } from "@/lib/query";
import { agentClient } from "@/lib/rpc";

const QUERY_KEY = ["scheduler", "tasks"] as const;

export function useSchedulerTasks() {
  const queryOptions = createSchemaQueryOptions({
    queryKey: QUERY_KEY,
    queryFn: () => agentClient.listSchedulerTasks({}),
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
      await agentClient.triggerSchedulerTask({ params: { name }, input: {} });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
