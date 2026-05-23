import {
  type LlmChatCallDetailResponse,
  LlmChatCallDetailResponseSchema,
} from "@kagami/shared/schemas/llm-chat";
import { useQuery } from "@tanstack/react-query";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";

export function useLlmChatCallDetail(id: number | null) {
  return useQuery({
    ...createSchemaQueryOptions<
      LlmChatCallDetailResponse,
      ReturnType<typeof queryKeys.llm.historyDetail>
    >({
      queryKey: queryKeys.llm.historyDetail(id ?? 0),
      path: `/llm-chat-call/${id ?? 0}`,
      schema: LlmChatCallDetailResponseSchema,
    }),
    enabled: id !== null,
  });
}
