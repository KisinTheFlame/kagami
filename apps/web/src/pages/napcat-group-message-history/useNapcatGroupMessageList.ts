import {
  NapcatGroupMessageListResponseSchema,
  type NapcatGroupMessageListQuery,
} from "@kagami/shared";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { buildQueryString } from "@/lib/search-params";

type NapcatGroupMessageListFilters = Omit<NapcatGroupMessageListQuery, "page" | "pageSize">;

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
        groupId: filters.groupId,
        userId: filters.userId,
        nickname: filters.nickname,
        keyword: filters.keyword,
        startAt: filters.startAt,
        endAt: filters.endAt,
      });

      const response = await apiFetch<unknown>(`/napcat-group-message/query?${query}`);
      return NapcatGroupMessageListResponseSchema.parse(response);
    },
  });
}
