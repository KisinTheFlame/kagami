import { type LlmChatCallListQuery } from "@kagami/console-api/llm-chat-call";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";
import { consoleClient } from "@/lib/rpc";

type LlmChatCallListFilters = Omit<LlmChatCallListQuery, "page" | "pageSize">;

export function useLlmChatCallList(
  page: number,
  pageSize: number,
  filters: LlmChatCallListFilters,
) {
  const params = {
    page,
    pageSize,
    provider: filters.provider,
    model: filters.model,
    scene: filters.scene,
    status: filters.status,
  };

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.llm.historyList(params),
      queryFn: () => consoleClient.queryLlmChatCalls(params),
    }),
  );
}
