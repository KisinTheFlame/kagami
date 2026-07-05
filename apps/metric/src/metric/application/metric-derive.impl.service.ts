import type { MetricChartQueryResponse } from "@kagami/metric-api/chart";
import type {
  MetricDeriveOp,
  MetricDeriveOperand as WireDeriveOperand,
  MetricDeriveRequest,
} from "@kagami/metric-api/derive";
import type { MetricDao, MetricDeriveOperand } from "../infra/metric.dao.js";
import { bucketToMilliseconds, listBucketStarts } from "./bucket-time.js";
import type { MetricDeriveService } from "./metric-derive.service.js";

type DefaultMetricDeriveServiceDeps = {
  metricDao: MetricDao;
};

/** 派生序列的稳定 key；展示 label / 颜色归前端，后端只给一个中性兜底 label。 */
const DERIVED_SERIES_KEY = "derived";

export class DefaultMetricDeriveService implements MetricDeriveService {
  private readonly metricDao: MetricDao;

  public constructor({ metricDao }: DefaultMetricDeriveServiceDeps) {
    this.metricDao = metricDao;
  }

  public async derive(request: MetricDeriveRequest): Promise<MetricChartQueryResponse> {
    const startAt = new Date(request.startAt);
    const endAt = new Date(request.endAt);

    const rows = await this.metricDao.queryDerivedSeries({
      numerator: toDaoOperand(request.numerator),
      denominator: toDaoOperand(request.denominator),
      op: request.op,
      startAt,
      endAt,
      bucket: request.bucket,
    });

    const bucketMs = bucketToMilliseconds(request.bucket);
    const bucketStarts = listBucketStarts(startAt, endAt, bucketMs);
    const valueByBucket = new Map<number, number | null>();
    for (const row of rows) {
      valueByBucket.set(row.bucketStart.getTime(), row.value);
    }

    // 派生缺桶恒 null（ratio/diff 任一侧无数据即无定义），前端断线、不臆造 0。
    const points = bucketStarts.map(bucketStart => ({
      bucketStart: bucketStart.toISOString(),
      value: valueByBucket.get(bucketStart.getTime()) ?? null,
    }));

    return {
      bucket: request.bucket,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      series: [{ key: DERIVED_SERIES_KEY, label: deriveFallbackLabel(request.op), points }],
    };
  }
}

function toDaoOperand(operand: WireDeriveOperand): MetricDeriveOperand {
  return {
    metricName: operand.metricName,
    aggregator: operand.aggregator,
    tagFilters: operand.tagFilters ?? null,
  };
}

function deriveFallbackLabel(op: MetricDeriveOp): string {
  return op === "ratio" ? "比率" : "差值";
}
