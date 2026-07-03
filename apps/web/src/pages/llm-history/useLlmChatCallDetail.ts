import { contractUrl } from "@kagami/http/url";
import { consoleApiContract } from "@kagami/console-api/contract";
import {
  type LlmChatCallDetailResponse,
  LlmChatCallDetailResponseSchema,
} from "@kagami/console-api/llm-chat-call";
import { useQuery } from "@tanstack/react-query";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";

export function useLlmChatCallDetail(id: number | null) {
  return useQuery({
    ...createSchemaQueryOptions<
      LlmChatCallDetailResponse,
      ReturnType<typeof queryKeys.llm.historyDetail>
    >({
      queryKey: queryKeys.llm.historyDetail(id ?? 0),
      // id 为 null 时 enabled=false 不会发请求；占位 1 只为通过 params 的 positive 校验。
      path: contractUrl(consoleApiContract.getLlmChatCallDetail, { params: { id: id ?? 1 } }),
      schema: LlmChatCallDetailResponseSchema,
    }),
    enabled: id !== null,
  });
}
