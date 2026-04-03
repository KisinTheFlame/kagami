import { QueryClient, keepPreviousData, queryOptions, type QueryKey } from "@tanstack/react-query";
import { apiGetWithSchema } from "@/lib/api";
import { buildQueryString } from "@/lib/search-params";

type QueryParamValue = string | number | undefined;
type QueryParams = Record<string, QueryParamValue>;

type SchemaLike<T> = {
  parse: (value: unknown) => T;
};

type CreateSchemaQueryOptionsParams<T, TQueryKey extends QueryKey> = {
  queryKey: TQueryKey;
  path: string;
  schema: SchemaLike<T>;
  params?: QueryParams;
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
    playgroundTools: () => ["llm", "playground-tools"] as const,
    historyList: (params: QueryParams) => ["llm-chat-call", "list", params] as const,
  },
  appLog: {
    historyList: (params: QueryParams) => ["app-log", "list", params] as const,
  },
  napcatEvent: {
    historyList: (params: QueryParams) => ["napcat-event", "list", params] as const,
  },
  napcatGroupMessage: {
    historyList: (params: QueryParams) => ["napcat-group-message", "list", params] as const,
  },
  story: {
    historyList: (params: QueryParams) => ["story", "list", params] as const,
  },
  metricChart: {
    root: () => ["metric-chart"] as const,
    list: () => ["metric-chart", "list"] as const,
    dataRoot: () => ["metric-chart", "data"] as const,
    data: (chartName: string, bucket: string, appliedRange: unknown) =>
      ["metric-chart", "data", chartName, bucket, appliedRange] as const,
  },
  agentDashboard: {
    current: () => ["agent-dashboard", "current"] as const,
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
  path,
  schema,
  params,
  keepPrevious = false,
}: CreateSchemaQueryOptionsParams<T, TQueryKey>) {
  return queryOptions({
    queryKey,
    queryFn: () => apiGetWithSchema(buildPathWithQuery(path, params), schema),
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

function buildPathWithQuery(path: string, params?: QueryParams): string {
  if (!params) {
    return path;
  }

  const query = buildQueryString(params);
  return query.length > 0 ? `${path}?${query}` : path;
}
