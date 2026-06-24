import {
  MainAgentContextCompactionResultSchema,
  type MainAgentContextCompactionResult,
} from "@kagami/shared/schemas/main-agent-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPostWithSchema } from "@/lib/api";
import { queryKeys } from "@/lib/query";

export function useCompactMainAgentContext() {
  const queryClient = useQueryClient();
  return useMutation<MainAgentContextCompactionResult>({
    mutationFn: async () => {
      return await apiPostWithSchema(
        "/main-agent-context/compact",
        {},
        MainAgentContextCompactionResultSchema,
      );
    },
    onSuccess: () => {
      // 压缩会重建上下文，主动让上下文快照重新拉取一次。
      void queryClient.invalidateQueries({ queryKey: queryKeys.mainAgentContext.recent() });
    },
  });
}
