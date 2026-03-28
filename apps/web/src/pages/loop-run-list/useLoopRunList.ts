import { LoopRunListResponseSchema, type LoopRunListQuery } from "@kagami/shared/schemas/loop-run";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { buildQueryString } from "@/lib/search-params";

type LoopRunListFilters = Omit<LoopRunListQuery, "page" | "pageSize">;

export function useLoopRunList(page: number, pageSize: number, filters: LoopRunListFilters) {
  return useQuery({
    queryKey: ["loop-run-list", page, pageSize, filters],
    queryFn: async () => {
      const query = buildQueryString({
        page: String(page),
        pageSize: String(pageSize),
        status: filters.status,
        groupId: filters.groupId,
      });

      const response = await apiFetch<unknown>(`/loop-run/query?${query}`);
      return LoopRunListResponseSchema.parse(response);
    },
  });
}
