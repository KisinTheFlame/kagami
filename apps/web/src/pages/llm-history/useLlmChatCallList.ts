import {
  type LlmChatCallListQuery,
  type LlmChatCallListResponse,
  LlmChatCallListResponseSchema,
} from "@kagami/shared/schemas/llm-chat";
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
  } satisfies Record<string, string | undefined>;

  return useQuery(
    createHistoryListQueryOptions<LlmChatCallListResponse, ReturnType<typeof queryKeys.llm.historyList>>(
      {
        queryKey: queryKeys.llm.historyList(params),
        path: "/llm-chat-call/query",
        schema: LlmChatCallListResponseSchema,
        params,
      },
    ),
  );
}
