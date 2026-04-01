import type {
  MetricChartCreateRequest,
  MetricChartCreateResponse,
  MetricChartDataQuery,
  MetricChartDataResponse,
  MetricChartDeleteRequest,
  MetricChartDeleteResponse,
  MetricChartListResponse,
} from "@kagami/shared/schemas/metric-chart";

export interface MetricChartService {
  list(): Promise<MetricChartListResponse>;
  create(input: MetricChartCreateRequest): Promise<MetricChartCreateResponse>;
  delete(input: MetricChartDeleteRequest): Promise<MetricChartDeleteResponse>;
  queryData(query: MetricChartDataQuery): Promise<MetricChartDataResponse>;
}
