import type {
  MetricPointsQueryRequest,
  MetricPointsQueryResponse,
} from "@kagami/metric-api/points";

export interface MetricPointsService {
  query(request: MetricPointsQueryRequest): Promise<MetricPointsQueryResponse>;
}
