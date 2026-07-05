import {
  MetricChartQueryResponseSchema,
  type MetricChartQueryRequest,
} from "@kagami/metric-api/chart";
import { metricApiContract } from "@kagami/metric-api/contract";
import { contractUrl } from "@kagami/http/url";
import { useQuery } from "@tanstack/react-query";
import { apiPostWithSchema } from "@/lib/api";
import { queryKeys } from "@/lib/query";

// === 取数层：只管 react-query + 契约 path + POST + zod parse（#444）===
//
// 图表定义已迁回代码，此 hook 直接把内联聚合规格 POST 给 /metric/query。与展示层
// (<MetricChartView />) 解耦，方便日后一页多图共享 range 或页面自控 range 时复用。

export function useMetricChartData(request: MetricChartQueryRequest, enabled = true) {
  return useQuery({
    queryKey: queryKeys.metricChart.data(request),
    queryFn: () =>
      apiPostWithSchema(
        contractUrl(metricApiContract.query),
        request,
        MetricChartQueryResponseSchema,
      ),
    enabled,
  });
}
