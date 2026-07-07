import { describe, expect, it } from "vitest";
import { MetricPointsQueryRequestSchema } from "@kagami/metric-api/points";

// raw 端点的硬边界 guard 全落在这份 wire schema：无 aggregator/bucket（strict 拒绝），range 上限 7 天，
// 点数不在 schema 层挡（走服务端行数 LIMIT + truncated）。

describe("MetricPointsQueryRequestSchema guards", () => {
  it("accepts a valid preset request", () => {
    const result = MetricPointsQueryRequestSchema.safeParse({
      metricName: "llm.oauth.quota.remaining_percent",
      groupByTag: "window",
      rangePreset: "7d",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid custom range request", () => {
    const result = MetricPointsQueryRequestSchema.safeParse({
      metricName: "llm.oauth.quota.remaining_percent",
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-02T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an aggregator field (strict, raw has no aggregation)", () => {
    const result = MetricPointsQueryRequestSchema.safeParse({
      metricName: "llm.oauth.quota.remaining_percent",
      aggregator: "last",
      rangePreset: "1d",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bucket field (strict, raw has no bucketing)", () => {
    const result = MetricPointsQueryRequestSchema.safeParse({
      metricName: "llm.oauth.quota.remaining_percent",
      bucket: "30m",
      rangePreset: "1d",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when the range exceeds 7 days", () => {
    const result = MetricPointsQueryRequestSchema.safeParse({
      metricName: "llm.oauth.quota.remaining_percent",
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-09T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when no range is provided", () => {
    const result = MetricPointsQueryRequestSchema.safeParse({
      metricName: "llm.oauth.quota.remaining_percent",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when preset and custom range are mixed", () => {
    const result = MetricPointsQueryRequestSchema.safeParse({
      metricName: "llm.oauth.quota.remaining_percent",
      rangePreset: "1d",
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-02T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when startAt is after endAt", () => {
    const result = MetricPointsQueryRequestSchema.safeParse({
      metricName: "llm.oauth.quota.remaining_percent",
      startAt: "2026-07-02T00:00:00.000Z",
      endAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
