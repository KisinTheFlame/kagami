import {
  METRIC_POINTS_MAX_POINTS,
  METRIC_POINTS_RANGE_PRESET_MILLISECONDS,
  type MetricPointsQueryRequest,
  type MetricPointsQueryResponse,
  type MetricPointsSeries,
} from "@kagami/metric-api/points";
import { BizError } from "@kagami/kernel/errors/biz-error";
import type { MetricDao, MetricRawPointRow } from "../infra/metric.dao.js";
import type { MetricPointsService } from "./metric-points.service.js";

type DefaultMetricPointsServiceDeps = {
  metricDao: MetricDao;
};

const UNGROUPED_SERIES_KEY = "__ungrouped__";
const DEFAULT_SINGLE_SERIES_KEY = "__default__";

/**
 * raw 原始点查询：低频 gauge 不聚合、不分桶，把范围内每个原始点照画（对齐 <MetricChart> 的分组/命名
 * 语义，但 points 是原始点而非桶）。行数 guard 走 LIMIT：DAO 按 occurred_at DESC 取 MAX+1 条，若命中
 * MAX+1 则 truncated=true 且只保留最近 MAX 点（丢最旧点）；每条 series 输出前重排为 occurred_at 升序。
 */
export class DefaultMetricPointsService implements MetricPointsService {
  private readonly metricDao: MetricDao;

  public constructor({ metricDao }: DefaultMetricPointsServiceDeps) {
    this.metricDao = metricDao;
  }

  public async query(request: MetricPointsQueryRequest): Promise<MetricPointsQueryResponse> {
    const { startAt, endAt } = resolveTimeRange(request);

    // 多取一条判 truncated：命中 MAX+1 说明范围内实际点数超上限。
    const rows = await this.metricDao.queryRawPoints({
      metricName: request.metricName,
      tagFilters: request.tagFilters ?? null,
      groupByTag: request.groupByTag ?? null,
      startAt,
      endAt,
      limit: METRIC_POINTS_MAX_POINTS + 1,
    });

    const truncated = rows.length > METRIC_POINTS_MAX_POINTS;
    // DESC 序，保留最近 MAX 条（丢最旧）。
    const kept = truncated ? rows.slice(0, METRIC_POINTS_MAX_POINTS) : rows;

    return {
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      truncated,
      series: buildSeries({ request, rows: kept }),
    };
  }
}

function resolveTimeRange(request: MetricPointsQueryRequest): { startAt: Date; endAt: Date } {
  if (request.rangePreset) {
    const endAt = new Date();
    const startAt = new Date(
      endAt.getTime() - METRIC_POINTS_RANGE_PRESET_MILLISECONDS[request.rangePreset],
    );
    return { startAt, endAt };
  }

  if (!request.startAt || !request.endAt) {
    throw new BizError({
      message: "Metric raw 查询时间范围不合法",
      meta: {
        reason: "METRIC_POINTS_RANGE_INVALID",
      },
      statusCode: 400,
    });
  }

  return {
    startAt: new Date(request.startAt),
    endAt: new Date(request.endAt),
  };
}

function buildSeries(params: {
  request: MetricPointsQueryRequest;
  rows: MetricRawPointRow[];
}): MetricPointsSeries[] {
  const pointsBySeriesKey = new Map<string, { label: string; rows: MetricRawPointRow[] }>();

  for (const row of params.rows) {
    const { key, label } = resolveSeriesIdentity({
      request: params.request,
      seriesKey: row.seriesKey,
    });

    const existing = pointsBySeriesKey.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      pointsBySeriesKey.set(key, { label, rows: [row] });
    }
  }

  return [...pointsBySeriesKey.entries()].map(([key, { label, rows }]) => ({
    key,
    label,
    // DAO 返回 DESC，前端画线要升序：按 occurredAt 升序（同刻不做二次 tiebreak，稀疏 gauge 无碰撞）。
    points: rows
      .slice()
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
      .map(row => ({
        occurredAt: row.occurredAt.toISOString(),
        value: row.value,
      })),
  }));
}

function resolveSeriesIdentity(params: {
  request: MetricPointsQueryRequest;
  seriesKey: string | null;
}): { key: string; label: string } {
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
