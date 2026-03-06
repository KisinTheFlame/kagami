import { NapcatEventListResponseSchema, type NapcatEventListQuery } from "@kagami/shared";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

type NapcatEventListFilters = Omit<NapcatEventListQuery, "page" | "pageSize">;

export function useNapcatEventList(
  page: number,
  pageSize: number,
  filters: NapcatEventListFilters,
) {
  return useQuery({
    queryKey: ["napcat-event", page, pageSize, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });

      setIfDefined(params, "postType", filters.postType);
      setIfDefined(params, "messageType", filters.messageType);
      setIfDefined(params, "userId", filters.userId);
      setIfDefined(params, "keyword", filters.keyword);
      setIfDefined(params, "startAt", filters.startAt);
      setIfDefined(params, "endAt", filters.endAt);

      const response = await apiFetch<unknown>(`/napcat-event/query?${params.toString()}`);
      return NapcatEventListResponseSchema.parse(response);
    },
  });
}

function setIfDefined(params: URLSearchParams, key: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  params.set(key, value);
}
