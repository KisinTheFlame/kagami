import { useQuery } from "@tanstack/react-query";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";
import { consoleClient } from "@/lib/rpc";

export function useLlmChatCallDetail(id: number | null) {
  return useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.llm.historyDetail(id ?? 0),
      // id 为 null 时 enabled=false 不会发请求；占位 1 只为通过 params 的 positive 校验。
      queryFn: () => consoleClient.getLlmChatCallDetail({ params: { id: id ?? 1 }, input: {} }),
    }),
    enabled: id !== null,
  });
}
