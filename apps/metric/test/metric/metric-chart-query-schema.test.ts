import { describe, expect, it } from "vitest";
import { MetricChartQueryRequestSchema } from "@kagami/metric-api/chart";

// 图表定义迁回代码后，/metric/query 的硬边界 guard 全落在这份 wire schema 上（#444）。
// 后端 handler 用 bare Fastify 无统一错误处理，400 语义在 schema 层测最准。

describe("MetricChartQueryRequestSchema guards", () => {
  it("accepts a valid preset request", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "1h",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid custom range request", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "sum",
      bucket: "5m",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T01:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when the point count exceeds the cap (2d @ 10s)", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "10s",
      rangePreset: "2d",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when tagFilters exceed the max key count", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "10m",
      tagFilters: { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a custom range wider than the max span", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1h",
      startAt: "2026-04-01T00:00:00.000Z",
      endAt: "2026-04-04T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects mixing rangePreset with custom start/end", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "1h",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T01:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when startAt is after endAt", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      startAt: "2026-04-02T01:00:00.000Z",
      endAt: "2026-04-02T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when neither preset nor custom range is provided", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when only one of startAt/endAt is provided", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      startAt: "2026-04-02T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "10m",
      chartName: "旧字段",
    });
    expect(result.success).toBe(false);
  });
});
