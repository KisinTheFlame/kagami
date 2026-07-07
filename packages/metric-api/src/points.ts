import { z } from "zod";
import { MetricChartTagFiltersSchema } from "./chart.js";

// === Metric raw 原始点查询 wire schema ===
//
// query（#444）为高频事件 metric 而生：aggregator + bucket 必填，按桶聚合。但对**低频 gauge**
// （如每 10 分钟一采的 OAuth 额度剩余百分比），桶聚合是错误工具——桶太细造一堆空桶且超点数上限，
// 桶太粗把多个原始点塌成一个。raw 端点不聚合、不分桶，按 occurred_at 直接返回范围内每个原始点，
// 按 groupByTag 分组。这是通用基建：任何低频 gauge（额度、余额、队列深度）都可复用。
//
// 与 query 的两点关键差异：
// - 无 aggregator / 无 bucket（.strict() 会拒绝携带这两个字段）。
// - 点数 guard 走**行数 LIMIT**（raw 点数由数据密度决定，不能像 query 那样用 range×bucket 预算），
//   因此 range 上限可放宽到 7 天（query 是 2 天），行数由 LIMIT 兜底。

/** raw 一次查询最多返回的原始点数（行数 LIMIT 兜底，超出则 truncated）。 */
export const METRIC_POINTS_MAX_POINTS = 2000;
/** raw 时间跨度上限（7 天）：低频 gauge 常查 7d，且行数已由 LIMIT 兜底，故比 query 的 2 天宽松。 */
export const METRIC_POINTS_MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

export const MetricPointsRangePresetSchema = z.enum(["1h", "3h", "6h", "12h", "1d", "2d", "7d"]);

export type MetricPointsRangePreset = z.infer<typeof MetricPointsRangePresetSchema>;

export const METRIC_POINTS_RANGE_PRESET_MILLISECONDS: Record<MetricPointsRangePreset, number> = {
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "2d": 2 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export const MetricPointsQueryRequestSchema = z
  .object({
    metricName: z.string().trim().min(1),
    // tagFilters 复用 query 的 eq/ne/in 判别联合（同一 key 一个过滤、跨 key 取 AND）。
    tagFilters: MetricChartTagFiltersSchema.optional(),
    groupByTag: z.string().trim().min(1).optional(),
    rangePreset: MetricPointsRangePresetSchema.optional(),
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
      rangeMs = METRIC_POINTS_RANGE_PRESET_MILLISECONDS[value.rangePreset];
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

    // raw 只查 range 上限，不查点数（点数由数据密度决定，服务端行数 LIMIT 兜底 + truncated 标记）。
    if (rangeMs > METRIC_POINTS_MAX_RANGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rangePreset"],
        message: `时间跨度不能超过 ${METRIC_POINTS_MAX_RANGE_MS / (24 * 60 * 60 * 1000)} 天`,
      });
    }
  });

export type MetricPointsQueryRequest = z.infer<typeof MetricPointsQueryRequestSchema>;

export const MetricPointsSeriesPointSchema = z
  .object({
    occurredAt: z.string().datetime(),
    value: z.number(),
  })
  .strict();

export type MetricPointsSeriesPoint = z.infer<typeof MetricPointsSeriesPointSchema>;

export const MetricPointsSeriesSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    points: z.array(MetricPointsSeriesPointSchema),
  })
  .strict();

export type MetricPointsSeries = z.infer<typeof MetricPointsSeriesSchema>;

export const MetricPointsQueryResponseSchema = z
  .object({
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    // 命中行数超上限：只返回最近 METRIC_POINTS_MAX_POINTS 点，truncated=true 供前端提示。
    truncated: z.boolean(),
    series: z.array(MetricPointsSeriesSchema),
  })
  .strict();

export type MetricPointsQueryResponse = z.infer<typeof MetricPointsQueryResponseSchema>;
