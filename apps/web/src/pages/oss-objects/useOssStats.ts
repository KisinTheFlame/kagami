import { contractUrl } from "@kagami/http/url";
import { ossConsoleContract } from "@kagami/oss-api/contract";
import { type OssStatsResponse, OssStatsResponseSchema } from "@kagami/oss-api/oss-object";
import { useQuery } from "@tanstack/react-query";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";

export function useOssStats() {
  return useQuery(
    createSchemaQueryOptions<OssStatsResponse, ReturnType<typeof queryKeys.ossObject.stats>>({
      queryKey: queryKeys.ossObject.stats(),
      path: contractUrl(ossConsoleContract.getStats),
      schema: OssStatsResponseSchema,
    }),
  );
}
