import { z } from "zod";

// === Metric 图表查询 wire schema（issue #444）===
//
// 图表定义已从 DB 迁回代码：不再有存储的图表实体、chartName、CRUD。前端在使用处内联声明整份
// 聚合规格（metricName / aggregator / tagFilters / groupByTag / bucket / range），本端点直接按
// 规格聚合。为防一次请求把 SQLite / 进程拖死，schema 层带硬边界 guard（点数 / tagFilters 数 /
// 时间跨度）；分组 series top-N 上限在服务端 buildSeries 后处理。

export const MetricChartAggregatorSchema = z.enum([
  "sum",
  "count",
  "avg",
  "max",
  "min",
  "last",
  // 百分位（p50/p95/p99）：桶内原始样本现算（DuckDB quantile_cont）。延迟看均值会骗人，观测刚需。
  "p50",
  "p95",
  "p99",
]);

export type MetricChartAggregator = z.infer<typeof MetricChartAggregatorSchema>;

export const MetricChartBucketSchema = z.enum(["10s", "1m", "5m", "30m", "1h"]);

export type MetricChartBucket = z.infer<typeof MetricChartBucketSchema>;

export const MetricChartRangePresetSchema = z.enum([
  "1m",
  "10m",
  "30m",
  "1h",
  "3h",
  "6h",
  "12h",
  "1d",
  "2d",
]);

export type MetricChartRangePreset = z.infer<typeof MetricChartRangePresetSchema>;

/** 一次查询最多返回的桶数（防超细 bucket + 长范围爆点）。 */
export const METRIC_CHART_MAX_POINTS = 2000;
/** tagFilters 最多键数。 */
export const METRIC_CHART_MAX_TAG_FILTERS = 5;
/** 单个 `in` 过滤的取值上限（防超长 in 列表撑爆 SQL / DoS）。 */
export const METRIC_CHART_MAX_TAG_FILTER_VALUES = 20;
/** 时间跨度上限（2 天，与 rangePreset 上限一致）。 */
export const METRIC_CHART_MAX_RANGE_MS = 2 * 24 * 60 * 60 * 1000;

// tag 过滤从「等值 AND」扩到 op 判别联合（#475 P2）：eq/ne 单值、in 多值。同一 key 一个过滤，
// 跨 key 取 AND。「Wait vs 非Wait」用两条查询（各带一条 eq / ne 过滤），不做派生分组 DSL。
export const MetricChartTagFilterSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("eq"), value: z.string() }).strict(),
  z.object({ op: z.literal("ne"), value: z.string() }).strict(),
  z
    .object({
      op: z.literal("in"),
      value: z.array(z.string().min(1)).min(1).max(METRIC_CHART_MAX_TAG_FILTER_VALUES),
    })
    .strict(),
]);

export type MetricChartTagFilter = z.infer<typeof MetricChartTagFilterSchema>;

export const MetricChartTagFiltersSchema = z
  .record(z.string().min(1), MetricChartTagFilterSchema)
  .refine(value => Object.keys(value).length <= METRIC_CHART_MAX_TAG_FILTERS, {
    message: `tagFilters 最多 ${METRIC_CHART_MAX_TAG_FILTERS} 个`,
  });

export type MetricChartTagFilters = z.infer<typeof MetricChartTagFiltersSchema>;

const BUCKET_MILLISECONDS: Record<MetricChartBucket, number> = {
  "10s": 10 * 1000,
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

const RANGE_PRESET_MILLISECONDS: Record<MetricChartRangePreset, number> = {
  "1m": 60 * 1000,
  "10m": 10 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "2d": 2 * 24 * 60 * 60 * 1000,
};

export const MetricChartQueryRequestSchema = z
  .object({
    metricName: z.string().trim().min(1),
    aggregator: MetricChartAggregatorSchema,
    bucket: MetricChartBucketSchema,
    tagFilters: MetricChartTagFiltersSchema.optional(),
    groupByTag: z.string().trim().min(1).optional(),
    rangePreset: MetricChartRangePresetSchema.optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasPreset = value.rangePreset !== undefined;
    const hasCustomStart = value.startAt !== undefined;
    const hasCustomEnd = value.endAt !== undefined;

    if (!hasPreset && !hasCustomStart && !hasCustomEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rangePreset"],
        message: "rangePreset or startAt/endAt is required",
      });
      return;
    }

    if (hasPreset && (hasCustomStart || hasCustomEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rangePreset"],
        message: "rangePreset and startAt/endAt cannot be used together",
      });
      return;
    }

    if (hasCustomStart !== hasCustomEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasCustomStart ? ["endAt"] : ["startAt"],
        message: "startAt and endAt must both be provided",
      });
      return;
    }

    let rangeMs: number;
    if (value.rangePreset) {
      rangeMs = RANGE_PRESET_MILLISECONDS[value.rangePreset];
    } else if (value.startAt && value.endAt) {
      const startAt = new Date(value.startAt).getTime();
      const endAt = new Date(value.endAt).getTime();
      if (startAt > endAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startAt"],
          message: "startAt must be less than or equal to endAt",
        });
        return;
      }
      rangeMs = endAt - startAt;
    } else {
      return;
    }

    if (rangeMs > METRIC_CHART_MAX_RANGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rangePreset"],
        message: `时间跨度不能超过 ${METRIC_CHART_MAX_RANGE_MS / (24 * 60 * 60 * 1000)} 天`,
      });
      return;
    }

    // 与服务端 listBucketStarts 的闭区间桶数对齐（floor(range/b)+1），避免 guard 比实际桶数少算 1。
    const points = Math.floor(rangeMs / BUCKET_MILLISECONDS[value.bucket]) + 1;
    if (points > METRIC_CHART_MAX_POINTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bucket"],
        message: `点数超限（${points} > ${METRIC_CHART_MAX_POINTS}），请增大 bucket 或缩短范围`,
      });
    }
  });

export type MetricChartQueryRequest = z.infer<typeof MetricChartQueryRequestSchema>;

export const MetricChartSeriesPointSchema = z
  .object({
    bucketStart: z.string().datetime(),
    value: z.number().nullable(),
  })
  .strict();

export type MetricChartSeriesPoint = z.infer<typeof MetricChartSeriesPointSchema>;

export const MetricChartSeriesSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    points: z.array(MetricChartSeriesPointSchema),
  })
  .strict();

export type MetricChartSeries = z.infer<typeof MetricChartSeriesSchema>;

export const MetricChartQueryResponseSchema = z
  .object({
    bucket: MetricChartBucketSchema,
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    series: z.array(MetricChartSeriesSchema),
  })
  .strict();

export type MetricChartQueryResponse = z.infer<typeof MetricChartQueryResponseSchema>;
