import type {
  MetricChartCreateRequest,
  MetricChartCreateResponse,
  MetricChartDataQuery,
  MetricChartDataResponse,
  MetricChartDeleteRequest,
  MetricChartDeleteResponse,
  MetricChartListResponse,
} from "@kagami/metric-api/chart";

export interface MetricChartService {
  list(): Promise<MetricChartListResponse>;
  create(input: MetricChartCreateRequest): Promise<MetricChartCreateResponse>;
  delete(input: MetricChartDeleteRequest): Promise<MetricChartDeleteResponse>;
  queryData(query: MetricChartDataQuery): Promise<MetricChartDataResponse>;
}
