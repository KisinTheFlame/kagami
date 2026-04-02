import {
  NapcatQqMessageListResponseSchema,
  type NapcatQqMessageListQuery,
} from "@kagami/shared/schemas/napcat-group-message";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { buildQueryString } from "@/lib/search-params";

type NapcatGroupMessageListFilters = Omit<NapcatQqMessageListQuery, "page" | "pageSize">;

export function useNapcatGroupMessageList(
  page: number,
  pageSize: number,
  filters: NapcatGroupMessageListFilters,
) {
  return useQuery({
    queryKey: ["napcat-group-message", page, pageSize, filters],
    queryFn: async () => {
      const query = buildQueryString({
        page: String(page),
        pageSize: String(pageSize),
        messageType: filters.messageType,
        groupId: filters.groupId,
        userId: filters.userId,
        nickname: filters.nickname,
        keyword: filters.keyword,
        startAt: filters.startAt,
        endAt: filters.endAt,
      });

      const response = await apiFetch<unknown>(`/napcat-group-message/query?${query}`);
      return NapcatQqMessageListResponseSchema.parse(response);
    },
  });
}
