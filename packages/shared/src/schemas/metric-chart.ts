import { z } from "zod";
import { parseOptionalStringInput } from "./base.js";

export const MetricChartAggregatorSchema = z.enum(["sum", "count", "avg", "max", "min", "last"]);

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

export const MetricChartTagFiltersSchema = z.record(z.string().min(1), z.string());

export type MetricChartTagFilters = z.infer<typeof MetricChartTagFiltersSchema>;

export const MetricChartDefinitionSchema = z
  .object({
    chartName: z.string().min(1),
    metricName: z.string().min(1),
    aggregator: MetricChartAggregatorSchema,
    tagFilters: MetricChartTagFiltersSchema.nullable(),
    groupByTag: z.string().min(1).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type MetricChartDefinition = z.infer<typeof MetricChartDefinitionSchema>;

export const MetricChartListResponseSchema = z
  .object({
    items: z.array(MetricChartDefinitionSchema),
  })
  .strict();

export type MetricChartListResponse = z.infer<typeof MetricChartListResponseSchema>;

export const MetricChartCreateRequestSchema = z
  .object({
    chartName: z.string().trim().min(1),
    metricName: z.string().trim().min(1),
    aggregator: MetricChartAggregatorSchema,
    tagFilters: MetricChartTagFiltersSchema.optional(),
    groupByTag: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  })
  .strict();

export type MetricChartCreateRequest = z.infer<typeof MetricChartCreateRequestSchema>;

export const MetricChartCreateResponseSchema = z
  .object({
    chart: MetricChartDefinitionSchema,
  })
  .strict();

export type MetricChartCreateResponse = z.infer<typeof MetricChartCreateResponseSchema>;

export const MetricChartDeleteRequestSchema = z
  .object({
    chartName: z.string().trim().min(1),
  })
  .strict();

export type MetricChartDeleteRequest = z.infer<typeof MetricChartDeleteRequestSchema>;

export const MetricChartDeleteResponseSchema = z
  .object({
    chartName: z.string().min(1),
    deleted: z.literal(true),
  })
  .strict();

export type MetricChartDeleteResponse = z.infer<typeof MetricChartDeleteResponseSchema>;

export const MetricChartDataQuerySchema = z
  .object({
    chartName: z.string().min(1),
    bucket: MetricChartBucketSchema,
    rangePreset: z.preprocess(parseOptionalStringInput, MetricChartRangePresetSchema.optional()),
    startAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
    endAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
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
    }

    if (hasCustomStart !== hasCustomEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasCustomStart ? ["endAt"] : ["startAt"],
        message: "startAt and endAt must both be provided",
      });
      return;
    }

    if (value.startAt && value.endAt) {
      const startAt = new Date(value.startAt).getTime();
      const endAt = new Date(value.endAt).getTime();
      if (startAt > endAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startAt"],
          message: "startAt must be less than or equal to endAt",
        });
      }
    }
  });

export type MetricChartDataQuery = z.infer<typeof MetricChartDataQuerySchema>;

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

export const MetricChartDataResponseSchema = z
  .object({
    chart: MetricChartDefinitionSchema,
    bucket: MetricChartBucketSchema,
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    series: z.array(MetricChartSeriesSchema),
  })
  .strict();

export type MetricChartDataResponse = z.infer<typeof MetricChartDataResponseSchema>;
