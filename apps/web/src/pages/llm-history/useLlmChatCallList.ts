import { contractUrl } from "@kagami/http/url";
import { consoleApiContract } from "@kagami/console-api/contract";
import {
  type LlmChatCallListQuery,
  type LlmChatCallListResponse,
  LlmChatCallListResponseSchema,
} from "@kagami/console-api/llm-chat-call";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";

type LlmChatCallListFilters = Omit<LlmChatCallListQuery, "page" | "pageSize">;

export function useLlmChatCallList(
  page: number,
  pageSize: number,
  filters: LlmChatCallListFilters,
) {
  const params = {
    page: String(page),
    pageSize: String(pageSize),
    provider: filters.provider,
    model: filters.model,
    status: filters.status,
    from: filters.from,
    to: filters.to,
  } satisfies Record<string, string | undefined>;

  return useQuery(
    createHistoryListQueryOptions<
      LlmChatCallListResponse,
      ReturnType<typeof queryKeys.llm.historyList>
    >({
      queryKey: queryKeys.llm.historyList(params),
      path: contractUrl(consoleApiContract.queryLlmChatCalls),
      schema: LlmChatCallListResponseSchema,
      params,
    }),
  );
}
