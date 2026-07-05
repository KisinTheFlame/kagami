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

export interface MetricDao {
  insert(input: InsertMetricInput): Promise<void>;
  queryChartSeries(input: QueryMetricChartSeriesInput): Promise<MetricChartSeriesRow[]>;
  /** 关停时释放 DuckDB 连接与实例。 */
  close(): void;
}
