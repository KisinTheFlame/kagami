// 聚合器 / 时间桶枚举由存储层自持：与 metric-api 的 wire schema 取值一致但不共享（#279 PR0）。
export type MetricChartAggregator =
  | "sum"
  | "count"
  | "avg"
  | "min"
  | "max"
  | "last"
  | "p50"
  | "p95"
  | "p99";
export type MetricChartBucket = "10s" | "1m" | "5m" | "30m" | "1h";

export type MetricTags = Record<string, string>;

/** tag 过滤条件（#475 P2）：eq/ne 单值，in 多值。跨 key 取 AND。 */
export type MetricTagFilter =
  | { op: "eq"; value: string }
  | { op: "ne"; value: string }
  | { op: "in"; value: string[] };

export type MetricTagFilters = Record<string, MetricTagFilter>;

export type InsertMetricInput = {
  metricName: string;
  value: number;
  tags: MetricTags;
  occurredAt?: Date;
};

export type QueryMetricChartSeriesInput = {
  metricName: string;
  aggregator: MetricChartAggregator;
  tagFilters: MetricTagFilters | null;
  groupByTag: string | null;
  startAt: Date;
  endAt: Date;
  bucket: MetricChartBucket;
};

export type MetricChartSeriesRow = {
  bucketStart: Date;
  seriesKey: string | null;
  value: number | null;
};

// 派生查询（#475 P3）：分子/分母各一份「无分组」聚合规格，共享 range/bucket。
export type MetricDeriveOp = "ratio" | "diff";

export type MetricDeriveOperand = {
  metricName: string;
  aggregator: MetricChartAggregator;
  tagFilters: MetricTagFilters | null;
};

export type QueryDerivedSeriesInput = {
  numerator: MetricDeriveOperand;
  denominator: MetricDeriveOperand;
  op: MetricDeriveOp;
  startAt: Date;
  endAt: Date;
  bucket: MetricChartBucket;
};

export type MetricDerivedSeriesRow = {
  bucketStart: Date;
  value: number | null;
};

// raw 原始点查询：无聚合、无分桶，按 occurred_at 直接取范围内每个原始点。行数 LIMIT 兜底
// （raw 点数由数据密度决定，不能用 range×bucket 预算）；DAO 按 occurred_at DESC 取最近 limit 条。
export type QueryMetricRawPointsInput = {
  metricName: string;
  tagFilters: MetricTagFilters | null;
  groupByTag: string | null;
  startAt: Date;
  endAt: Date;
  limit: number;
};

export type MetricRawPointRow = {
  occurredAt: Date;
  seriesKey: string | null;
  value: number;
};

export interface MetricDao {
  insert(input: InsertMetricInput): Promise<void>;
  queryChartSeries(input: QueryMetricChartSeriesInput): Promise<MetricChartSeriesRow[]>;
  /** 派生查询：一条 SQL 按桶对齐分子/分母算 ratio/diff，出单条派生线（#475 P3）。 */
  queryDerivedSeries(input: QueryDerivedSeriesInput): Promise<MetricDerivedSeriesRow[]>;
  /** raw 原始点查询：按 occurred_at DESC 取最近 `limit` 条原始点（不聚合、不分桶）。 */
  queryRawPoints(input: QueryMetricRawPointsInput): Promise<MetricRawPointRow[]>;
  /** 关停时释放 DuckDB 连接与实例。 */
  close(): void;
}
