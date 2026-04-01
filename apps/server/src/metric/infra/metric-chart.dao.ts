import type { CreateMetricChartInput, MetricChartItem } from "../domain/metric.js";

export interface MetricChartDao {
  create(input: CreateMetricChartInput): Promise<MetricChartItem>;
  findByChartName(chartName: string): Promise<MetricChartItem | null>;
  deleteByChartName(chartName: string): Promise<boolean>;
  list(): Promise<MetricChartItem[]>;
}
