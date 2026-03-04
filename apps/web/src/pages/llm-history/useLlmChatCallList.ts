import { useQuery } from "@tanstack/react-query";
import { LlmChatCallListResponseSchema } from "@kagami/shared";
import { apiFetch } from "@/lib/api";

export function useLlmChatCallList(page: number, pageSize: number) {
  return useQuery({
    queryKey: ["llm-chat-call", page, pageSize],
    queryFn: async () => {
      const response = await apiFetch<unknown>(
        `/llm-chat-call/query?page=${page}&pageSize=${pageSize}`,
      );
      return LlmChatCallListResponseSchema.parse(response);
    },
  });
}
