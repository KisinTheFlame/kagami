import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query";
import { agentClient } from "@/lib/rpc";

export function useCompactMainAgentContext() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => agentClient.compactMainAgentContext({}),
    onSuccess: () => {
      // 压缩会重建上下文，主动让上下文快照重新拉取一次。
      void queryClient.invalidateQueries({ queryKey: queryKeys.mainAgentContext.recent() });
    },
  });
}
