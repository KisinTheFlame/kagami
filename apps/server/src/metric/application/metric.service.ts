import type { MetricTags } from "../domain/metric.js";

export type RecordMetricInput = {
  metricName: string;
  value: number;
  tags?: MetricTags;
  occurredAt?: Date;
};

export interface MetricService {
  record(input: RecordMetricInput): Promise<void>;
}
