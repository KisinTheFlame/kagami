import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SchedulerTriggerResponse } from "@kagami/scheduler-api/trigger";
import { createSchemaQueryOptions } from "@/lib/query";
import { schedulerTasksClient, schedulerTriggerClient } from "@/lib/rpc";

const QUERY_KEY = ["scheduler", "tasks"] as const;

export function useSchedulerTasks() {
  const queryOptions = createSchemaQueryOptions({
    queryKey: QUERY_KEY,
    // #493 P4：前端第一次直连 scheduler 的全局查询（经 gateway /api/scheduler/tasks），不再经 agent。
    queryFn: () => schedulerTasksClient.listTasks({}),
  });

  return useQuery({
    ...queryOptions,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });
}

/** 触发变量：定位到具体 owner 的具体任务（全局视图里任务不再唯一由 name 标识）。 */
export type TriggerVariables = {
  ownerId: string;
  taskName: string;
};

export function useTriggerSchedulerTask() {
  const queryClient = useQueryClient();
  return useMutation<SchedulerTriggerResponse, Error, TriggerVariables>({
    // #493 P4：触发经 scheduler 的统一入口（前端 → scheduler → 反向 callback 回 owner），返回
    // accepted | rejected(unknown_task|overlap) | owner_unreachable 判别联合，交给页面按 outcome 提示。
    mutationFn: ({ ownerId, taskName }) =>
      schedulerTriggerClient.triggerTask({ params: { ownerId, taskName }, input: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
