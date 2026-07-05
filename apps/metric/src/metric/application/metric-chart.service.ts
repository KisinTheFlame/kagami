import type { MetricChartQueryRequest, MetricChartQueryResponse } from "@kagami/metric-api/chart";

export interface MetricChartService {
  query(request: MetricChartQueryRequest): Promise<MetricChartQueryResponse>;
}
