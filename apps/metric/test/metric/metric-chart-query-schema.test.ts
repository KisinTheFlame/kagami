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
    const eq = (value: string) => ({ op: "eq" as const, value });
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "10m",
      tagFilters: { a: eq("1"), b: eq("2"), c: eq("3"), d: eq("4"), e: eq("5"), f: eq("6") },
    });
    expect(result.success).toBe(false);
  });

  it("accepts eq / ne / in tag filters", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "p95",
      bucket: "1m",
      rangePreset: "10m",
      tagFilters: {
        tool: { op: "eq", value: "Wait" },
        runtime: { op: "ne", value: "agent" },
        model: { op: "in", value: ["gpt-4o", "sonnet"] },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown tag filter op", () => {
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "10m",
      tagFilters: { tool: { op: "gt", value: "5" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an in filter that is empty or exceeds the value cap", () => {
    const empty = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "10m",
      tagFilters: { tool: { op: "in", value: [] } },
    });
    expect(empty.success).toBe(false);

    const tooMany = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "10m",
      tagFilters: {
        tool: { op: "in", value: Array.from({ length: 21 }, (_unused, i) => `v${i}`) },
      },
    });
    expect(tooMany.success).toBe(false);
  });

  it("accepts percentile aggregators", () => {
    for (const aggregator of ["p50", "p95", "p99"]) {
      const result = MetricChartQueryRequestSchema.safeParse({
        metricName: "llm.latency",
        aggregator,
        bucket: "1m",
        rangePreset: "10m",
      });
      expect(result.success).toBe(true);
    }
  });

  it("counts points by the aligned bucket axis, not (end-start)/bucket (off-by-one guard)", () => {
    // start/end 都不落桶边界：对齐补桶得 2001 个，旧的 floor(range/bucket)+1 只算 2000 会误放行。
    const result = MetricChartQueryRequestSchema.safeParse({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "10s",
      startAt: "2026-01-01T00:00:09.999Z",
      endAt: "2026-01-01T05:33:28.999Z",
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
