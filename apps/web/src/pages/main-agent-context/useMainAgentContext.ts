import { MainAgentContextSnapshotSchema } from "@kagami/shared/schemas/main-agent-context";
import { useQuery } from "@tanstack/react-query";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";

export function useMainAgentContext() {
  const queryOptions = createSchemaQueryOptions({
    queryKey: queryKeys.mainAgentContext.recent(),
    path: "/main-agent-context/recent",
    schema: MainAgentContextSnapshotSchema,
  });

  return useQuery({
    ...queryOptions,
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });
}
