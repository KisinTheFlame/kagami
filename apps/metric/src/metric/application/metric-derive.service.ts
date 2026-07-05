import type { MetricChartQueryResponse } from "@kagami/metric-api/chart";
import type { MetricDeriveRequest } from "@kagami/metric-api/derive";

export interface MetricDeriveService {
  derive(request: MetricDeriveRequest): Promise<MetricChartQueryResponse>;
}
