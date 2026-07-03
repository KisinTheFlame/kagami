// 聚合器 / 时间桶枚举由存储层自持：与 metric-api 的 wire schema 取值一致但不共享（#279 PR0）。
export type MetricChartAggregator = "sum" | "count" | "avg" | "max" | "min" | "last";
export type MetricChartBucket = "10s" | "1m" | "5m" | "30m" | "1h";

export type MetricTags = Record<string, string>;

export type InsertMetricInput = {
  metricName: string;
  value: number;
  tags: MetricTags;
  occurredAt?: Date;
};

export type QueryMetricChartSeriesInput = {
  metricName: string;
  aggregator: MetricChartAggregator;
  tagFilters: MetricTags | null;
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
}
