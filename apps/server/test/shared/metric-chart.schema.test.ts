import { describe, expect, it } from "vitest";
import {
  MetricChartCreateRequestSchema,
  MetricChartDataQuerySchema,
  MetricChartDataResponseSchema,
} from "@kagami/shared/schemas/metric-chart";

describe("metric chart schemas", () => {
  it("should parse create request with optional defaults", () => {
    const result = MetricChartCreateRequestSchema.parse({
      chartName: "OpenAI 按模型 Token 消耗",
      metricName: "llm.token.total",
      aggregator: "sum",
      tagFilters: {
        provider: "openai",
      },
      groupByTag: "model",
    });

    expect(result).toEqual({
      chartName: "OpenAI 按模型 Token 消耗",
      metricName: "llm.token.total",
      aggregator: "sum",
      tagFilters: {
        provider: "openai",
      },
      groupByTag: "model",
    });
  });

  it("should parse either preset or custom time ranges", () => {
    expect(
      MetricChartDataQuerySchema.parse({
        chartName: "总请求量",
        bucket: "1m",
        rangePreset: "10m",
      }),
    ).toEqual({
      chartName: "总请求量",
      bucket: "1m",
      rangePreset: "10m",
    });

    expect(
      MetricChartDataQuerySchema.parse({
        chartName: "总请求量",
        bucket: "1m",
        startAt: "2026-04-02T00:00:00.000Z",
        endAt: "2026-04-02T00:10:00.000Z",
      }),
    ).toEqual({
      chartName: "总请求量",
      bucket: "1m",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T00:10:00.000Z",
    });
  });

  it("should reject mixed preset and custom ranges", () => {
    const result = MetricChartDataQuerySchema.safeParse({
      chartName: "总请求量",
      bucket: "1m",
      rangePreset: "10m",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T00:10:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("should parse chart data responses", () => {
    const result = MetricChartDataResponseSchema.parse({
      chart: {
        chartName: "总请求量",
        metricName: "http.request",
        aggregator: "count",
        tagFilters: null,
        groupByTag: null,
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:05:00.000Z",
      },
      bucket: "1m",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T00:10:00.000Z",
      series: [
        {
          key: "__default__",
          label: "总请求量",
          points: [
            {
              bucketStart: "2026-04-02T00:00:00.000Z",
              value: 3,
            },
          ],
        },
      ],
    });

    expect(result.series).toHaveLength(1);
  });
});
