import { type LlmChatCallListQuery, LlmChatCallListResponseSchema } from "@kagami/shared";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

type LlmChatCallListFilters = Omit<LlmChatCallListQuery, "page" | "pageSize">;

export function useLlmChatCallList(
  page: number,
  pageSize: number,
  filters: LlmChatCallListFilters,
) {
  return useQuery({
    queryKey: ["llm-chat-call", page, pageSize, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });

      setIfDefined(params, "status", filters.status);

      const response = await apiFetch<unknown>(`/llm-chat-call/query?${params.toString()}`);
      return LlmChatCallListResponseSchema.parse(response);
    },
  });
}

function setIfDefined(params: URLSearchParams, key: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  params.set(key, value);
}
