import { contractUrl } from "@kagami/http/url";
import { consoleApiContract } from "@kagami/console-api/contract";
import {
  NapcatQqMessageListResponseSchema,
  type NapcatQqMessageListQuery,
} from "@kagami/console-api/napcat-group-message";
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
      path: contractUrl(consoleApiContract.queryNapcatQqMessages),
      schema: NapcatQqMessageListResponseSchema,
      params,
    }),
  );
}
