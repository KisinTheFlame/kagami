import { QueryClient, keepPreviousData, queryOptions, type QueryKey } from "@tanstack/react-query";

type QueryParamValue = string | number | undefined;
type QueryParams = Record<string, QueryParamValue>;

type CreateSchemaQueryOptionsParams<T, TQueryKey extends QueryKey> = {
  queryKey: TQueryKey;
  queryFn: () => Promise<T>;
  keepPrevious?: boolean;
};

export const queryKeys = {
  auth: {
    provider: (provider: string) => ["auth", provider] as const,
    status: (provider: string) => ["auth", provider, "status"] as const,
    usageLimits: (provider: string) => ["auth", provider, "usage-limits"] as const,
    usageTrend: (provider: string, range: string) =>
      ["auth", provider, "usage-trend", range] as const,
  },
  llm: {
    providers: () => ["llm", "providers"] as const,
    historyList: (params: QueryParams) => ["llm-chat-call", "list", params] as const,
    historyDetail: (id: number) => ["llm-chat-call", "detail", id] as const,
  },
  appLog: {
    historyList: (params: QueryParams) => ["app-log", "list", params] as const,
  },
  innerThought: {
    historyList: (params: QueryParams) => ["inner-thought", "list", params] as const,
  },
  napcatEvent: {
    historyList: (params: QueryParams) => ["napcat-event", "list", params] as const,
  },
  napcatGroupMessage: {
    historyList: (params: QueryParams) => ["napcat-group-message", "list", params] as const,
  },
  todo: {
    historyList: (params: QueryParams) => ["todo", "list", params] as const,
  },
  ossObject: {
    historyList: (params: QueryParams) => ["oss-object", "list", params] as const,
    stats: () => ["oss-object", "stats"] as const,
  },
  metricChart: {
    data: (request: unknown) => ["metric-chart", "data", request] as const,
    derived: (request: unknown) => ["metric-chart", "derived", request] as const,
  },
  mainAgentContext: {
    recent: () => ["main-agent-context", "recent"] as const,
  },
};

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 5_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function createSchemaQueryOptions<T, TQueryKey extends QueryKey>({
  queryKey,
  queryFn,
  keepPrevious = false,
}: CreateSchemaQueryOptionsParams<T, TQueryKey>) {
  return queryOptions({
    queryKey,
    queryFn,
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
  });
}

export function createHistoryListQueryOptions<T, TQueryKey extends QueryKey>(
  params: Omit<CreateSchemaQueryOptionsParams<T, TQueryKey>, "keepPrevious">,
) {
  return createSchemaQueryOptions({
    ...params,
    keepPrevious: true,
  });
}
