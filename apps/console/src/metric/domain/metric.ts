export const METRIC_CHART_AGGREGATORS = ["sum", "count", "avg", "max", "min", "last"] as const;

export type MetricChartAggregator = (typeof METRIC_CHART_AGGREGATORS)[number];

export type MetricTags = Record<string, string>;

export type MetricChartItem = {
  id: number;
  chartName: string;
  metricName: string;
  aggregator: MetricChartAggregator;
  tagFilters: MetricTags | null;
  groupByTag: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateMetricChartInput = {
  chartName: string;
  metricName: string;
  aggregator: MetricChartAggregator;
  tagFilters?: MetricTags;
  groupByTag?: string;
};
