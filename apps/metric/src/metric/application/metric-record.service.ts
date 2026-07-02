import type { RecordMetricRequest } from "@kagami/metric-api/record";

export interface MetricRecordService {
  record(input: RecordMetricRequest): Promise<void>;
}
