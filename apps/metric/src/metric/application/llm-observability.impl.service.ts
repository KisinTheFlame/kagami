import type {
  LlmOverviewQuery,
  LlmOverviewResponse,
  LlmTimeseriesQuery,
  LlmTimeseriesResponse,
  ObservabilityMetric,
  ObservabilitySeries,
} from "@kagami/metric-api/observability";
import type {
  LlmObservabilityBucket,
  LlmObservabilityDao,
  LlmTimeseriesRow,
} from "@kagami/persistence/dao/llm-observability.dao";
import type { LlmObservabilityService } from "./llm-observability.service.js";

type DefaultLlmObservabilityServiceDeps = {
  llmObservabilityDao: LlmObservabilityDao;
};

// 单序列（无 groupBy）的稳定 key/label：让前端不必区分「有没有分组」。
const SINGLE_SERIES_KEY = "__all__";
const SINGLE_SERIES_LABEL = "全部";
// 分组维度取值为空串时的兜底序列。
const UNGROUPED_SERIES_KEY = "__ungrouped__";
const UNGROUPED_SERIES_LABEL = "未分组";

export class DefaultLlmObservabilityService implements LlmObservabilityService {
  private readonly llmObservabilityDao: LlmObservabilityDao;

  public constructor({ llmObservabilityDao }: DefaultLlmObservabilityServiceDeps) {
    this.llmObservabilityDao = llmObservabilityDao;
  }

  public async overview(query: LlmOverviewQuery): Promise<LlmOverviewResponse> {
    const range = { from: new Date(query.from), to: new Date(query.to) };
    const [stats, byModel] = await Promise.all([
      this.llmObservabilityDao.overviewStats(range),
      this.llmObservabilityDao.modelBreakdown(range),
    ]);

    const errorRate = stats.totalCalls === 0 ? 0 : stats.errorCount / stats.totalCalls;

    return {
      from: query.from,
      to: query.to,
      totalCalls: stats.totalCalls,
      errorCount: stats.errorCount,
      errorRate,
      latencyAvgMs: stats.latencyAvgMs,
      latencyP95Ms: stats.latencyP95Ms,
      tokens: {
        prompt: stats.promptTokens,
        completion: stats.completionTokens,
        total: stats.totalTokens,
        cacheHit: stats.cacheHitTokens,
        cacheMiss: stats.cacheMissTokens,
      },
      byModel,
    };
  }

  public async timeseries(query: LlmTimeseriesQuery): Promise<LlmTimeseriesResponse> {
    const range = { from: new Date(query.from), to: new Date(query.to) };
    const filters = {
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.model ? { model: query.model } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const rows = await this.llmObservabilityDao.timeseries({
      range,
      bucket: query.bucket,
      metric: query.metric,
      ...(query.groupBy ? { groupBy: query.groupBy } : {}),
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
    });

    return {
      from: query.from,
      to: query.to,
      bucket: query.bucket,
      metric: query.metric,
      series: buildSeries({
        rows,
        from: range.from,
        to: range.to,
        bucket: query.bucket,
        metric: query.metric,
        grouped: query.groupBy !== undefined,
      }),
    };
  }
}

function buildSeries(params: {
  rows: LlmTimeseriesRow[];
  from: Date;
  to: Date;
  bucket: LlmObservabilityBucket;
  metric: ObservabilityMetric;
  grouped: boolean;
}): ObservabilitySeries[] {
  const bucketMs = bucketToMilliseconds(params.bucket);
  const bucketStarts = listBucketStarts(params.from, params.to, bucketMs);
  const missingValue = missingBucketValue(params.metric);

  const valuesBySeries = new Map<string, Map<number, number | null>>();
  const seriesLabels = new Map<string, string>();

  for (const row of params.rows) {
    const { key, label } = resolveSeriesIdentity({
      grouped: params.grouped,
      seriesKey: row.seriesKey,
    });
    if (!valuesBySeries.has(key)) {
      valuesBySeries.set(key, new Map());
      seriesLabels.set(key, label);
    }
    valuesBySeries.get(key)?.set(row.bucketStart.getTime(), row.value);
  }

  // 无数据也回一条空点序列（单序列场景），让前端画出空态而非直接没图。
  if (valuesBySeries.size === 0 && !params.grouped) {
    valuesBySeries.set(SINGLE_SERIES_KEY, new Map());
    seriesLabels.set(SINGLE_SERIES_KEY, SINGLE_SERIES_LABEL);
  }

  return [...valuesBySeries.entries()].map(([key, pointsByBucket]) => ({
    key,
    label: seriesLabels.get(key) ?? key,
    points: bucketStarts.map(bucketStart => ({
      bucketStart: bucketStart.toISOString(),
      value: pointsByBucket.get(bucketStart.getTime()) ?? missingValue,
    })),
  }));
}

function resolveSeriesIdentity(params: { grouped: boolean; seriesKey: string | null }): {
  key: string;
  label: string;
} {
  if (!params.grouped) {
    return { key: SINGLE_SERIES_KEY, label: SINGLE_SERIES_LABEL };
  }

  const normalized = params.seriesKey?.trim();
  if (!normalized) {
    return { key: UNGROUPED_SERIES_KEY, label: UNGROUPED_SERIES_LABEL };
  }

  return { key: normalized, label: normalized };
}

function listBucketStarts(from: Date, to: Date, bucketMs: number): Date[] {
  const alignedStart = Math.floor(from.getTime() / bucketMs) * bucketMs;
  const alignedEnd = Math.floor(to.getTime() / bucketMs) * bucketMs;
  const buckets: Date[] = [];
  for (let current = alignedStart; current <= alignedEnd; current += bucketMs) {
    buckets.push(new Date(current));
  }
  return buckets;
}

function missingBucketValue(metric: ObservabilityMetric): number | null {
  switch (metric) {
    case "calls":
    case "errors":
      return 0;
    case "latencyAvg":
    case "latencyP95":
      return null;
  }
}

function bucketToMilliseconds(bucket: LlmObservabilityBucket): number {
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
