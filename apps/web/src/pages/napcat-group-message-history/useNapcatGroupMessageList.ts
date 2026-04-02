import {
  NapcatQqMessageListResponseSchema,
  type NapcatQqMessageListQuery,
} from "@kagami/shared/schemas/napcat-group-message";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";

type NapcatGroupMessageListFilters = Omit<NapcatQqMessageListQuery, "page" | "pageSize">;

export function useNapcatGroupMessageList(
  page: number,
  pageSize: number,
  filters: NapcatGroupMessageListFilters,
) {
  const params = {
    page: String(page),
    pageSize: String(pageSize),
    messageType: filters.messageType,
    groupId: filters.groupId,
    userId: filters.userId,
    nickname: filters.nickname,
    keyword: filters.keyword,
    startAt: filters.startAt,
    endAt: filters.endAt,
  } satisfies Record<string, string | undefined>;

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.napcatGroupMessage.historyList(params),
      path: "/napcat-group-message/query",
      schema: NapcatQqMessageListResponseSchema,
      params,
    }),
  );
}
