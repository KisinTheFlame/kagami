import { LoopRunDetailResponseSchema } from "@kagami/shared";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export function useLoopRunDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["loop-run-detail", id],
    enabled: typeof id === "string" && id.length > 0,
    queryFn: async () => {
      const response = await apiFetch<unknown>(`/loop-run/${id}`);
      return LoopRunDetailResponseSchema.parse(response);
    },
  });
}
