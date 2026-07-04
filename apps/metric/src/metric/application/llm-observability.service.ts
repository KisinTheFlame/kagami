import type {
  LlmOverviewQuery,
  LlmOverviewResponse,
  LlmTimeseriesQuery,
  LlmTimeseriesResponse,
} from "@kagami/metric-api/observability";

/** LLM 行为观察台的只读查询门面。路由与 schema 单一事实源在 @kagami/metric-api。 */
export interface LlmObservabilityService {
  overview(query: LlmOverviewQuery): Promise<LlmOverviewResponse>;
  timeseries(query: LlmTimeseriesQuery): Promise<LlmTimeseriesResponse>;
}
