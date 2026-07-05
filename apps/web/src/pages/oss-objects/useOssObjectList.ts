import { contractUrl } from "@kagami/http/url";
import { ossConsoleContract } from "@kagami/oss-api/contract";
import {
  type OssObjectListResponse,
  OssObjectListResponseSchema,
} from "@kagami/oss-api/oss-object";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";

export type OssObjectListFilters = {
  mime?: string;
};

export function useOssObjectList(page: number, pageSize: number, filters: OssObjectListFilters) {
  const params = {
    page: String(page),
    pageSize: String(pageSize),
    mime: filters.mime,
  } satisfies Record<string, string | undefined>;

  return useQuery(
    createHistoryListQueryOptions<
      OssObjectListResponse,
      ReturnType<typeof queryKeys.ossObject.historyList>
    >({
      queryKey: queryKeys.ossObject.historyList(params),
      path: contractUrl(ossConsoleContract.queryObjects),
      schema: OssObjectListResponseSchema,
      params,
    }),
  );
}
