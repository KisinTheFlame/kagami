import {
  NapcatGroupMessageListResponseSchema,
  type NapcatGroupMessageListQuery,
} from "@kagami/shared";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

type NapcatGroupMessageListFilters = Omit<NapcatGroupMessageListQuery, "page" | "pageSize">;

export function useNapcatGroupMessageList(
  page: number,
  pageSize: number,
  filters: NapcatGroupMessageListFilters,
) {
  return useQuery({
    queryKey: ["napcat-group-message", page, pageSize, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });

      setIfDefined(params, "groupId", filters.groupId);
      setIfDefined(params, "userId", filters.userId);
      setIfDefined(params, "nickname", filters.nickname);
      setIfDefined(params, "keyword", filters.keyword);
      setIfDefined(params, "startAt", filters.startAt);
      setIfDefined(params, "endAt", filters.endAt);

      const response = await apiFetch<unknown>(`/napcat-group-message/query?${params.toString()}`);
      return NapcatGroupMessageListResponseSchema.parse(response);
    },
  });
}

function setIfDefined(params: URLSearchParams, key: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  params.set(key, value);
}
