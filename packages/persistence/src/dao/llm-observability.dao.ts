// LLM 行为观察台的只读聚合 DAO：直连 `llm_chat_call` 事实表跑 raw SQL 聚合。
// 与 metric.dao（通用 metric 表）正交——observability 不经 metric 打点，读的是真身。
// 枚举取值与 @kagami/metric-api 的 wire schema 一致但不共享（沿袭 #279 PR0 的存储层自持）。

export type LlmObservabilityBucket = "10s" | "1m" | "5m" | "30m" | "1h";
export type LlmObservabilityMetric = "calls" | "errors" | "latencyAvg" | "latencyP95";
export type LlmObservabilityGroupBy = "provider" | "model" | "status";

export type LlmObservabilityRange = {
  from: Date;
  to: Date;
};

/** 概览标量：一次扫表算齐（p95 单列另用 OFFSET 子查询，见 impl）。token 均已 COALESCE 成 0。 */
export type LlmOverviewStats = {
  totalCalls: number;
  errorCount: number;
  latencyAvgMs: number | null;
  latencyP95Ms: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
};

export type LlmModelCount = {
  provider: string;
  model: string;
  count: number;
};

export type LlmTimeseriesRow = {
  bucketStart: Date;
  // groupBy 缺省时为 null（单序列）；分组时为该维度的取值（空串归一到 null 由服务层兜）。
  seriesKey: string | null;
  value: number | null;
};

export type LlmObservabilityFilters = {
  provider?: string;
  model?: string;
  status?: "success" | "failed";
};

export type QueryLlmTimeseriesInput = {
  range: LlmObservabilityRange;
  bucket: LlmObservabilityBucket;
  metric: LlmObservabilityMetric;
  groupBy?: LlmObservabilityGroupBy;
  filters?: LlmObservabilityFilters;
};

export interface LlmObservabilityDao {
  overviewStats(range: LlmObservabilityRange): Promise<LlmOverviewStats>;
  modelBreakdown(range: LlmObservabilityRange): Promise<LlmModelCount[]>;
  timeseries(input: QueryLlmTimeseriesInput): Promise<LlmTimeseriesRow[]>;
}
