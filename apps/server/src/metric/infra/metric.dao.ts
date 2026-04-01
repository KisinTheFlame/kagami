import type { MetricChartAggregator, MetricChartBucket } from "@kagami/shared/schemas/metric-chart";
import type { MetricTags } from "../domain/metric.js";

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
