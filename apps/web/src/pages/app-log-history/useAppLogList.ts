import { AppLogListResponseSchema, type AppLogListQuery } from "@kagami/shared";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { buildQueryString } from "@/lib/search-params";

type AppLogListFilters = Omit<AppLogListQuery, "page" | "pageSize">;

export function useAppLogList(page: number, pageSize: number, filters: AppLogListFilters) {
  return useQuery({
    queryKey: ["app-log", page, pageSize, filters],
    queryFn: async () => {
      const query = buildQueryString({
        page: String(page),
        pageSize: String(pageSize),
        level: filters.level,
        traceId: filters.traceId,
        message: filters.message,
        source: filters.source,
        startAt: filters.startAt,
        endAt: filters.endAt,
      });

      const response = await apiFetch<unknown>(`/app-log/query?${query}`);
      return AppLogListResponseSchema.parse(response);
    },
  });
}
