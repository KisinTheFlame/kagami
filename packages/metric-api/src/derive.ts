import { z } from "zod";
import {
  MetricChartAggregatorSchema,
  MetricChartBucketSchema,
  MetricChartTagFiltersSchema,
  METRIC_CHART_MAX_POINTS,
  METRIC_CHART_MAX_RANGE_MS,
  metricChartBucketToMilliseconds,
} from "./chart.js";

// === Metric 派生查询 wire schema（#475 P3）===
//
// 单指标查询物理上出不了「两个数相除」（Wait 占全部调用的比例、错误率）。派生原语补这一层：
// 分子 / 分母各一份聚合规格，**共享 bucket + 显式时间范围**，后端一条 DuckDB SQL 按桶对齐算
// ratio / diff（NULLIF 除零、缺桶→null，语义在一条 SQL 里定死一次）。
//
// 硬边界：
// - 算子只 `ratio` / `diff` 两个枚举，永不长成表达式 DSL（YAGNI 红线）。
// - **禁用 rangePreset**：分子分母必须落在同一 range，服务端两次 `new Date()` 会错位（对抗审查
//   catch），故只接显式 startAt / endAt。
// - 出「整洁序列」单条派生线，复用 MetricChartQueryResponse（series 恰一条）；派生线的 label /
//   颜色归前端，wire 不加 color。

export const MetricDeriveOperandSchema = z
  .object({
    metricName: z.string().trim().min(1),
    aggregator: MetricChartAggregatorSchema,
    tagFilters: MetricChartTagFiltersSchema.optional(),
  })
  .strict();

export type MetricDeriveOperand = z.infer<typeof MetricDeriveOperandSchema>;

export const MetricDeriveOpSchema = z.enum(["ratio", "diff"]);

export type MetricDeriveOp = z.infer<typeof MetricDeriveOpSchema>;

export const MetricDeriveRequestSchema = z
  .object({
    numerator: MetricDeriveOperandSchema,
    denominator: MetricDeriveOperandSchema,
    op: MetricDeriveOpSchema,
    bucket: MetricChartBucketSchema,
    // 仅显式范围，无 rangePreset（分子分母共享同一 range）。
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, ctx) => {
    const startAt = new Date(value.startAt).getTime();
    const endAt = new Date(value.endAt).getTime();
    // datetime({offset}) 通常已挡，这里兜住 `new Date` 得到 Invalid 的越界偏移（如 +99:00）。
    if (Number.isNaN(startAt) || Number.isNaN(endAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startAt"],
        message: "startAt / endAt 不是合法时间",
      });
      return;
    }

    if (startAt > endAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startAt"],
        message: "startAt must be less than or equal to endAt",
      });
      return;
    }

    const rangeMs = endAt - startAt;
    if (rangeMs > METRIC_CHART_MAX_RANGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startAt"],
        message: `时间跨度不能超过 ${METRIC_CHART_MAX_RANGE_MS / (24 * 60 * 60 * 1000)} 天`,
      });
      return;
    }

    const points = Math.floor(rangeMs / metricChartBucketToMilliseconds(value.bucket)) + 1;
    if (points > METRIC_CHART_MAX_POINTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bucket"],
        message: `点数超限（${points} > ${METRIC_CHART_MAX_POINTS}），请增大 bucket 或缩短范围`,
      });
    }
  });

export type MetricDeriveRequest = z.infer<typeof MetricDeriveRequestSchema>;
