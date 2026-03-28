import {
  type LlmChatCallListQuery,
  type LlmChatCallListResponse,
  LlmChatCallListResponseSchema,
} from "@kagami/shared/schemas/llm-chat";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { buildQueryString } from "@/lib/search-params";

type LlmChatCallListFilters = Omit<LlmChatCallListQuery, "page" | "pageSize">;

export function useLlmChatCallList(
  page: number,
  pageSize: number,
  filters: LlmChatCallListFilters,
): UseQueryResult<LlmChatCallListResponse, Error> {
  return useQuery({
    queryKey: ["llm-chat-call", page, pageSize, filters],
    queryFn: async () => {
      const query = buildQueryString({
        page: String(page),
        pageSize: String(pageSize),
        provider: filters.provider,
        model: filters.model,
        status: filters.status,
      });

      const response = await apiFetch<unknown>(`/llm-chat-call/query?${query}`);
      return LlmChatCallListResponseSchema.parse(response);
    },
  });
}
