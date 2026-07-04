import { z } from "zod";
import { parseOptionalStringInput } from "@kagami/http/wire";

// === LLM 行为观察台的查询契约（观测台重做第一切片） ===
//
// 与 chart 那套「通用 metric 表 + 用户手搓图表」正交：observability 直连 `llm_chat_call`
// 事实表跑聚合，metric 从「唯一漏斗」降格为「数据源之一」。本文件只覆盖 LLM 域；quota /
// runtime 域下期各自新增，复用同一 ChartPanel + 下钻前端原语。

/** 时间桶粒度。与 metric-chart 的 bucket 取值一致（不共享，各自持有）。 */
export const ObservabilityBucketSchema = z.enum(["10s", "1m", "5m", "30m", "1h"]);

export type ObservabilityBucket = z.infer<typeof ObservabilityBucketSchema>;

/** 时序可选的分组维度：均为 `llm_chat_call` 的一等列。 */
export const ObservabilityGroupBySchema = z.enum(["provider", "model", "status"]);

export type ObservabilityGroupBy = z.infer<typeof ObservabilityGroupBySchema>;

/** 时序可选的过滤状态：供下钻「某 model」聚焦某状态用。 */
export const ObservabilityStatusSchema = z.enum(["success", "failed"]);

export type ObservabilityStatus = z.infer<typeof ObservabilityStatusSchema>;

/** 时序度量：要画哪条量。延迟类在无样本桶回 null（前端断线），计数类回 0。 */
export const ObservabilityMetricSchema = z.enum(["calls", "errors", "latencyAvg", "latencyP95"]);

export type ObservabilityMetric = z.infer<typeof ObservabilityMetricSchema>;

// 时间范围：from/to 均为带时区 ISO-8601（与 metric record 的 occurredAt 同规）。两者都必填，
// 前端从时间范围选择器算好再传，服务端不猜默认，避免「打开台子看到的是哪段时间」有歧义。
// refine 兜底越界 offset（如 `+99:00`）：datetime() 能过它却让 new Date 产出 Invalid Date，
// 不拦就会流到服务端 new Date → raw SQL 绑定 Invalid Date → 500。与 metric record 同一防线。
const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine(value => !Number.isNaN(new Date(value).getTime()), {
    message: "不是合法时间",
  });

// 时间窗上限：挡「from=1970&to=9999&bucket=10s」这类无害查询打成天量桶数组 / 全表扫描。
// 前端最宽 2d、桶数恒 < 200，这些上限只拦滥用、不碰真实用法。
const MAX_TIMESERIES_BUCKETS = 20_000;
const MAX_OVERVIEW_SPAN_MS = 366 * 24 * 60 * 60 * 1000;

const BUCKET_SECONDS: Record<ObservabilityBucket, number> = {
  "10s": 10,
  "1m": 60,
  "5m": 5 * 60,
  "30m": 30 * 60,
  "1h": 60 * 60,
};

function addRangeOrderIssue(from: string, to: string, ctx: z.RefinementCtx): boolean {
  if (new Date(from).getTime() > new Date(to).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["from"],
      message: "from 必须早于或等于 to",
    });
    return false;
  }
  return true;
}

export const LlmOverviewQuerySchema = z
  .object({
    from: IsoDateTimeSchema,
    to: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!addRangeOrderIssue(value.from, value.to, ctx)) {
      return;
    }
    const spanMs = new Date(value.to).getTime() - new Date(value.from).getTime();
    if (spanMs > MAX_OVERVIEW_SPAN_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "时间跨度过大",
      });
    }
  });

export type LlmOverviewQuery = z.infer<typeof LlmOverviewQuerySchema>;

// token 汇总：五个字段镜像 `response_payload.usage` 的归一化形状（跨 provider 一致）。
// 源字段 optional，聚合处 COALESCE 成 0，故这里都是非负整数、无 null。
export const LlmTokenTotalsSchema = z
  .object({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    cacheHit: z.number().int().nonnegative(),
    cacheMiss: z.number().int().nonnegative(),
  })
  .strict();

export type LlmTokenTotals = z.infer<typeof LlmTokenTotalsSchema>;

export const LlmModelBreakdownItemSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    count: z.number().int().nonnegative(),
  })
  .strict();

export type LlmModelBreakdownItem = z.infer<typeof LlmModelBreakdownItemSchema>;

export const LlmOverviewResponseSchema = z
  .object({
    from: IsoDateTimeSchema,
    to: IsoDateTimeSchema,
    totalCalls: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    // 0..1；totalCalls=0 时回 0（前端显示「—」由前端判定，契约不给 null）。
    errorRate: z.number().min(0).max(1),
    latencyAvgMs: z.number().nonnegative().nullable(),
    latencyP95Ms: z.number().nonnegative().nullable(),
    tokens: LlmTokenTotalsSchema,
    byModel: z.array(LlmModelBreakdownItemSchema),
  })
  .strict();

export type LlmOverviewResponse = z.infer<typeof LlmOverviewResponseSchema>;

export const LlmTimeseriesQuerySchema = z
  .object({
    from: IsoDateTimeSchema,
    to: IsoDateTimeSchema,
    bucket: ObservabilityBucketSchema,
    metric: ObservabilityMetricSchema,
    groupBy: z.preprocess(parseOptionalStringInput, ObservabilityGroupBySchema.optional()),
    // 下钻聚焦用的过滤（均为一等列）：如「只看某 model 的调用量时序」。与 groupBy 正交可叠加。
    provider: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
    model: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
    status: z.preprocess(parseOptionalStringInput, ObservabilityStatusSchema.optional()),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!addRangeOrderIssue(value.from, value.to, ctx)) {
      return;
    }
    // 桶数上限：拦超大跨度 + 细桶组合，避免服务端按桶生成天量数组（OOM）。
    const spanMs = new Date(value.to).getTime() - new Date(value.from).getTime();
    const bucketCount = spanMs / (BUCKET_SECONDS[value.bucket] * 1000);
    if (bucketCount > MAX_TIMESERIES_BUCKETS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bucket"],
        message: "时间跨度相对桶粒度过大",
      });
    }
  });

export type LlmTimeseriesQuery = z.infer<typeof LlmTimeseriesQuerySchema>;

export const ObservabilitySeriesPointSchema = z
  .object({
    bucketStart: IsoDateTimeSchema,
    value: z.number().nullable(),
  })
  .strict();

export type ObservabilitySeriesPoint = z.infer<typeof ObservabilitySeriesPointSchema>;

export const ObservabilitySeriesSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    points: z.array(ObservabilitySeriesPointSchema),
  })
  .strict();

export type ObservabilitySeries = z.infer<typeof ObservabilitySeriesSchema>;

export const LlmTimeseriesResponseSchema = z
  .object({
    from: IsoDateTimeSchema,
    to: IsoDateTimeSchema,
    bucket: ObservabilityBucketSchema,
    metric: ObservabilityMetricSchema,
    series: z.array(ObservabilitySeriesSchema),
  })
  .strict();

export type LlmTimeseriesResponse = z.infer<typeof LlmTimeseriesResponseSchema>;
