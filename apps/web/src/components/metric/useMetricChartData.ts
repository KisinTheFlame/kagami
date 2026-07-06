import { type MetricChartQueryRequest } from "@kagami/metric-api/chart";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query";
import { metricClient } from "@/lib/rpc";

// === 取数层：只管 react-query + 契约 client + POST（#444）===
//
// 图表定义已迁回代码，此 hook 直接把内联聚合规格 POST 给 /metric/query。与展示层
// (<MetricChartView />) 解耦，方便日后一页多图共享 range 或页面自控 range 时复用。

export function useMetricChartData(request: MetricChartQueryRequest, enabled = true) {
  return useQuery({
    queryKey: queryKeys.metricChart.data(request),
    queryFn: () => metricClient.query(request),
    enabled,
  });
}
