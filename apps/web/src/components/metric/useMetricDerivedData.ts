import { MetricChartQueryResponseSchema } from "@kagami/metric-api/chart";
import { metricApiContract } from "@kagami/metric-api/contract";
import { type MetricDeriveRequest } from "@kagami/metric-api/derive";
import { contractUrl } from "@kagami/http/url";
import { useQuery } from "@tanstack/react-query";
import { apiPostWithSchema } from "@/lib/api";
import { queryKeys } from "@/lib/query";

// === 派生取数层（#475 P3）===
//
// 与 useMetricChartData 同构：把内联的「分子/分母 + 算子」派生规格 POST 给 /metric/derive，出单条
// 派生线（复用 query 的整洁序列响应），交给同一套 <MetricChartView> 展示。派生线的 label / 颜色由
// 使用处（recipe）就近声明覆盖，后端只给中性兜底 label。

export function useMetricDerivedData(request: MetricDeriveRequest, enabled = true) {
  return useQuery({
    queryKey: queryKeys.metricChart.derived(request),
    queryFn: () =>
      apiPostWithSchema(
        contractUrl(metricApiContract.derive),
        request,
        MetricChartQueryResponseSchema,
      ),
    enabled,
  });
}
