import { NapcatEventListResponseSchema, type NapcatEventListQuery } from "@kagami/shared";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { buildQueryString } from "@/lib/search-params";

type NapcatEventListFilters = Omit<NapcatEventListQuery, "page" | "pageSize">;

export function useNapcatEventList(
  page: number,
  pageSize: number,
  filters: NapcatEventListFilters,
) {
  return useQuery({
    queryKey: ["napcat-event", page, pageSize, filters],
    queryFn: async () => {
      const query = buildQueryString({
        page: String(page),
        pageSize: String(pageSize),
        postType: filters.postType,
        messageType: filters.messageType,
        userId: filters.userId,
        keyword: filters.keyword,
        startAt: filters.startAt,
        endAt: filters.endAt,
      });

      const response = await apiFetch<unknown>(`/napcat-event/query?${query}`);
      return NapcatEventListResponseSchema.parse(response);
    },
  });
}
