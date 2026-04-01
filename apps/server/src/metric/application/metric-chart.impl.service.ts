import type {
  MetricChartAggregator,
  MetricChartCreateRequest,
  MetricChartCreateResponse,
  MetricChartDataQuery,
  MetricChartDataResponse,
  MetricChartDefinition,
  MetricChartDeleteRequest,
  MetricChartDeleteResponse,
  MetricChartListResponse,
  MetricChartRangePreset,
  MetricChartSeries,
} from "@kagami/shared/schemas/metric-chart";
import { BizError } from "../../common/errors/biz-error.js";
import type { MetricChartItem } from "../domain/metric.js";
import type { MetricChartDao } from "../infra/metric-chart.dao.js";
import type { MetricChartSeriesRow, MetricDao } from "../infra/metric.dao.js";
import type { MetricChartService } from "./metric-chart.service.js";

type DefaultMetricChartServiceDeps = {
  metricDao: MetricDao;
  metricChartDao: MetricChartDao;
};

const UNGROUPED_SERIES_KEY = "__ungrouped__";
const DEFAULT_SINGLE_SERIES_KEY = "__default__";

export class DefaultMetricChartService implements MetricChartService {
  private readonly metricDao: MetricDao;
  private readonly metricChartDao: MetricChartDao;

  public constructor({ metricDao, metricChartDao }: DefaultMetricChartServiceDeps) {
    this.metricDao = metricDao;
    this.metricChartDao = metricChartDao;
  }

  public async list(): Promise<MetricChartListResponse> {
    const items = await this.metricChartDao.list();
    return {
      items: items.map(mapMetricChartDefinition),
    };
  }

  public async create(input: MetricChartCreateRequest): Promise<MetricChartCreateResponse> {
    const normalized = normalizeCreateInput(input);
    const existing = await this.metricChartDao.findByChartName(normalized.chartName);
    if (existing) {
      throw new BizError({
        message: "Metric 图表已存在",
        meta: {
          reason: "METRIC_CHART_DUPLICATED",
          chartName: normalized.chartName,
        },
        statusCode: 409,
      });
    }

    const created = await this.metricChartDao.create(normalized);
    return {
      chart: mapMetricChartDefinition(created),
    };
  }

  public async delete(input: MetricChartDeleteRequest): Promise<MetricChartDeleteResponse> {
    const chartName = input.chartName.trim();
    const deleted = await this.metricChartDao.deleteByChartName(chartName);
    if (!deleted) {
      throw new BizError({
        message: "Metric 图表不存在",
        meta: {
          reason: "METRIC_CHART_NOT_FOUND",
          chartName,
        },
        statusCode: 404,
      });
    }

    return {
      chartName,
      deleted: true,
    };
  }

  public async queryData(query: MetricChartDataQuery): Promise<MetricChartDataResponse> {
    const chart = await this.metricChartDao.findByChartName(query.chartName);
    if (!chart) {
      throw new BizError({
        message: "Metric 图表不存在",
        meta: {
          reason: "METRIC_CHART_NOT_FOUND",
          chartName: query.chartName,
        },
        statusCode: 404,
      });
    }

    const { startAt, endAt } = resolveTimeRange(query);
    const rows = await this.metricDao.queryChartSeries({
      metricName: chart.metricName,
      aggregator: chart.aggregator,
      tagFilters: chart.tagFilters,
      groupByTag: chart.groupByTag,
      startAt,
      endAt,
      bucket: query.bucket,
    });

    return {
      chart: mapMetricChartDefinition(chart),
      bucket: query.bucket,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      series: buildSeries({
        chart,
        rows,
        startAt,
        endAt,
        bucket: query.bucket,
      }),
    };
  }
}

function normalizeCreateInput(input: MetricChartCreateRequest): MetricChartCreateRequest {
  const chartName = input.chartName.trim();
  const metricName = input.metricName.trim();
  const groupByTag = input.groupByTag?.trim() || undefined;
  const tagFilters =
    input.tagFilters && Object.keys(input.tagFilters).length > 0 ? input.tagFilters : undefined;

  return {
    chartName,
    metricName,
    aggregator: input.aggregator,
    tagFilters,
    groupByTag,
  };
}

function mapMetricChartDefinition(item: MetricChartItem): MetricChartDefinition {
  return {
    chartName: item.chartName,
    metricName: item.metricName,
    aggregator: item.aggregator,
    tagFilters: item.tagFilters,
    groupByTag: item.groupByTag,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function resolveTimeRange(query: MetricChartDataQuery): { startAt: Date; endAt: Date } {
  if (query.rangePreset) {
    const endAt = new Date();
    const startAt = new Date(endAt.getTime() - rangePresetToMilliseconds(query.rangePreset));
    return { startAt, endAt };
  }

  if (!query.startAt || !query.endAt) {
    throw new BizError({
      message: "Metric 图表查询时间范围不合法",
      meta: {
        reason: "METRIC_CHART_RANGE_INVALID",
      },
      statusCode: 400,
    });
  }

  return {
    startAt: new Date(query.startAt),
    endAt: new Date(query.endAt),
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
  chart: MetricChartItem;
  rows: MetricChartSeriesRow[];
  startAt: Date;
  endAt: Date;
  bucket: MetricChartDataQuery["bucket"];
}): MetricChartSeries[] {
  if (params.rows.length === 0) {
    return [];
  }

  const bucketMs = bucketToMilliseconds(params.bucket);
  const bucketStarts = listBucketStarts(params.startAt, params.endAt, bucketMs);
  const defaultValue = getMissingBucketValue(params.chart.aggregator);
  const rowsBySeriesKey = new Map<string, Map<number, number | null>>();
  const seriesLabels = new Map<string, string>();

  for (const row of params.rows) {
    const { key, label } = resolveSeriesIdentity({
      chart: params.chart,
      seriesKey: row.seriesKey,
    });
    const bucketStartMs = row.bucketStart.getTime();

    if (!rowsBySeriesKey.has(key)) {
      rowsBySeriesKey.set(key, new Map());
      seriesLabels.set(key, label);
    }

    rowsBySeriesKey.get(key)?.set(bucketStartMs, row.value);
  }

  return [...rowsBySeriesKey.entries()].map(([key, pointsByBucket]) => ({
    key,
    label: seriesLabels.get(key) ?? key,
    points: bucketStarts.map(bucketStart => ({
      bucketStart: bucketStart.toISOString(),
      value: pointsByBucket.get(bucketStart.getTime()) ?? defaultValue,
    })),
  }));
}

function resolveSeriesIdentity(params: { chart: MetricChartItem; seriesKey: string | null }): {
  key: string;
  label: string;
} {
  if (!params.chart.groupByTag) {
    return {
      key: DEFAULT_SINGLE_SERIES_KEY,
      label: params.chart.chartName,
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
    case "avg":
    case "max":
    case "min":
    case "last":
      return null;
  }
}

function bucketToMilliseconds(bucket: MetricChartDataQuery["bucket"]): number {
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
