import type {
  MetricChartAggregator,
  MetricChartQueryRequest,
  MetricChartQueryResponse,
  MetricChartRangePreset,
  MetricChartSeries,
} from "@kagami/metric-api/chart";
import { BizError } from "@kagami/kernel/errors/biz-error";
import type { MetricChartSeriesRow, MetricDao } from "../infra/metric.dao.js";
import type { MetricChartService } from "./metric-chart.service.js";

type DefaultMetricChartServiceDeps = {
  metricDao: MetricDao;
};

const UNGROUPED_SERIES_KEY = "__ungrouped__";
const DEFAULT_SINGLE_SERIES_KEY = "__default__";

export class DefaultMetricChartService implements MetricChartService {
  private readonly metricDao: MetricDao;

  public constructor({ metricDao }: DefaultMetricChartServiceDeps) {
    this.metricDao = metricDao;
  }

  public async query(request: MetricChartQueryRequest): Promise<MetricChartQueryResponse> {
    const { startAt, endAt } = resolveTimeRange(request);
    const rows = await this.metricDao.queryChartSeries({
      metricName: request.metricName,
      aggregator: request.aggregator,
      tagFilters: request.tagFilters ?? null,
      groupByTag: request.groupByTag ?? null,
      startAt,
      endAt,
      bucket: request.bucket,
    });

    return {
      bucket: request.bucket,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      series: buildSeries({
        request,
        rows,
        startAt,
        endAt,
        bucket: request.bucket,
      }),
    };
  }
}

function resolveTimeRange(request: MetricChartQueryRequest): { startAt: Date; endAt: Date } {
  if (request.rangePreset) {
    const endAt = new Date();
    const startAt = new Date(endAt.getTime() - rangePresetToMilliseconds(request.rangePreset));
    return { startAt, endAt };
  }

  if (!request.startAt || !request.endAt) {
    throw new BizError({
      message: "Metric 图表查询时间范围不合法",
      meta: {
        reason: "METRIC_CHART_RANGE_INVALID",
      },
      statusCode: 400,
    });
  }

  return {
    startAt: new Date(request.startAt),
    endAt: new Date(request.endAt),
  };
}

function rangePresetToMilliseconds(rangePreset: MetricChartRangePreset): number {
  switch (rangePreset) {
    case "1m":
      return 60 * 1000;
    case "10m":
      return 10 * 60 * 1000;
    case "30m":
      return 30 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "3h":
      return 3 * 60 * 60 * 1000;
    case "6h":
      return 6 * 60 * 60 * 1000;
    case "12h":
      return 12 * 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    case "2d":
      return 2 * 24 * 60 * 60 * 1000;
  }
}

function buildSeries(params: {
  request: MetricChartQueryRequest;
  rows: MetricChartSeriesRow[];
  startAt: Date;
  endAt: Date;
  bucket: MetricChartQueryRequest["bucket"];
}): MetricChartSeries[] {
  if (params.rows.length === 0) {
    return [];
  }

  const bucketMs = bucketToMilliseconds(params.bucket);
  const bucketStarts = listBucketStarts(params.startAt, params.endAt, bucketMs);
  const defaultValue = getMissingBucketValue(params.request.aggregator);
  const rowsBySeriesKey = new Map<string, Map<number, number | null>>();
  const seriesLabels = new Map<string, string>();

  for (const row of params.rows) {
    const { key, label } = resolveSeriesIdentity({
      request: params.request,
      seriesKey: row.seriesKey,
    });
    const bucketStartMs = row.bucketStart.getTime();

    if (!rowsBySeriesKey.has(key)) {
      rowsBySeriesKey.set(key, new Map());
      seriesLabels.set(key, label);
    }

    rowsBySeriesKey.get(key)?.set(bucketStartMs, row.value);
  }

  // series top-N 已在 DAO 的 SQL 层下推截断（≤MAX_SERIES），此处按 DAO 返回顺序原样成线。
  const keptKeys = [...rowsBySeriesKey.keys()];

  return keptKeys.map(key => {
    const pointsByBucket = rowsBySeriesKey.get(key) ?? new Map<number, number | null>();
    return {
      key,
      label: seriesLabels.get(key) ?? key,
      points: bucketStarts.map(bucketStart => ({
        bucketStart: bucketStart.toISOString(),
        value: pointsByBucket.get(bucketStart.getTime()) ?? defaultValue,
      })),
    };
  });
}

function resolveSeriesIdentity(params: {
  request: MetricChartQueryRequest;
  seriesKey: string | null;
}): {
  key: string;
  label: string;
} {
  if (!params.request.groupByTag) {
    return {
      key: DEFAULT_SINGLE_SERIES_KEY,
      label: params.request.metricName,
    };
  }

  const normalizedKey = params.seriesKey?.trim();
  if (!normalizedKey) {
    return {
      key: UNGROUPED_SERIES_KEY,
      label: "未分组",
    };
  }

  return {
    key: normalizedKey,
    label: normalizedKey,
  };
}

function listBucketStarts(startAt: Date, endAt: Date, bucketMs: number): Date[] {
  const alignedStartAt = new Date(Math.floor(startAt.getTime() / bucketMs) * bucketMs);
  const alignedEndAt = new Date(Math.floor(endAt.getTime() / bucketMs) * bucketMs);
  const buckets: Date[] = [];

  for (
    let current = alignedStartAt.getTime();
    current <= alignedEndAt.getTime();
    current += bucketMs
  ) {
    buckets.push(new Date(current));
  }

  return buckets;
}

function getMissingBucketValue(aggregator: MetricChartAggregator): number | null {
  switch (aggregator) {
    case "count":
    case "sum":
      return 0;
    // 空桶无样本 → avg/min/max/last 及百分位均无定义，记 null（前端断线，不画成 0）。
    case "avg":
    case "max":
    case "min":
    case "last":
    case "p50":
    case "p95":
    case "p99":
      return null;
  }
}

function bucketToMilliseconds(bucket: MetricChartQueryRequest["bucket"]): number {
  switch (bucket) {
    case "10s":
      return 10 * 1000;
    case "1m":
      return 60 * 1000;
    case "5m":
      return 5 * 60 * 1000;
    case "30m":
      return 30 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
  }
}
