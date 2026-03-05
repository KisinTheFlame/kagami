import { AppLogListResponseSchema, type AppLogListQuery } from "@kagami/shared";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

type AppLogListFilters = Omit<AppLogListQuery, "page" | "pageSize">;

export function useAppLogList(page: number, pageSize: number, filters: AppLogListFilters) {
  return useQuery({
    queryKey: ["app-log", page, pageSize, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });

      setIfDefined(params, "level", filters.level);
      setIfDefined(params, "traceId", filters.traceId);
      setIfDefined(params, "message", filters.message);
      setIfDefined(params, "source", filters.source);
      setIfDefined(params, "startAt", filters.startAt);
      setIfDefined(params, "endAt", filters.endAt);

      const response = await apiFetch<unknown>(`/app-log/query?${params.toString()}`);
      return AppLogListResponseSchema.parse(response);
    },
  });
}

function setIfDefined(params: URLSearchParams, key: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  params.set(key, value);
}
