import type { RecordMetricRequest } from "@kagami/shared/schemas/metric";

export interface MetricRecordService {
  record(input: RecordMetricRequest): Promise<void>;
}
