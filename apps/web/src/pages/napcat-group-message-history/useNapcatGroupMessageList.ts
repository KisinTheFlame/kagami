import { type NapcatQqMessageListQuery } from "@kagami/console-api/napcat-group-message";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";
import { consoleClient } from "@/lib/rpc";

type NapcatGroupMessageListFilters = Omit<NapcatQqMessageListQuery, "page" | "pageSize">;

export function useNapcatGroupMessageList(
  page: number,
  pageSize: number,
  filters: NapcatGroupMessageListFilters,
) {
  const params = {
    page,
    pageSize,
    messageType: filters.messageType,
    groupId: filters.groupId,
    userId: filters.userId,
    nickname: filters.nickname,
    keyword: filters.keyword,
    startAt: filters.startAt,
    endAt: filters.endAt,
  };

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.napcatGroupMessage.historyList(params),
      queryFn: () => consoleClient.queryNapcatQqMessages(params),
    }),
  );
}
