import { describe, expect, it } from "vitest";
import { MetricDeriveRequestSchema } from "@kagami/metric-api/derive";

// 派生查询的硬边界 guard 全落在这份 wire schema 上（#475 P3）：显式范围必填、禁 rangePreset、
// 算子只 ratio/diff、范围/点数上限复用 chart 的常量。

const numerator = { metricName: "agent.tool.call", aggregator: "count" as const };
const denominator = { metricName: "agent.tool.call", aggregator: "count" as const };

function baseRequest(over: Record<string, unknown> = {}) {
  return {
    numerator,
    denominator,
    op: "ratio",
    bucket: "1m",
    startAt: "2026-04-02T00:00:00.000Z",
    endAt: "2026-04-02T01:00:00.000Z",
    ...over,
  };
}

describe("MetricDeriveRequestSchema guards", () => {
  it("accepts a valid ratio request with per-operand tag filters", () => {
    const result = MetricDeriveRequestSchema.safeParse(
      baseRequest({
        numerator: {
          metricName: "agent.tool.call",
          aggregator: "count",
          tagFilters: { tool: { op: "eq", value: "Wait" } },
        },
        op: "ratio",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts diff and percentile operands", () => {
    const result = MetricDeriveRequestSchema.safeParse(
      baseRequest({
        numerator: { metricName: "llm.latency", aggregator: "p95" },
        denominator: { metricName: "llm.latency", aggregator: "p50" },
        op: "diff",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a rangePreset field (derive requires an explicit shared range)", () => {
    const result = MetricDeriveRequestSchema.safeParse(baseRequest({ rangePreset: "1h" }));
    expect(result.success).toBe(false);
  });

  it("rejects when startAt / endAt is missing", () => {
    const noStart = MetricDeriveRequestSchema.safeParse(baseRequest({ startAt: undefined }));
    expect(noStart.success).toBe(false);
  });

  it("rejects an unknown op", () => {
    const result = MetricDeriveRequestSchema.safeParse(baseRequest({ op: "product" }));
    expect(result.success).toBe(false);
  });

  it("rejects startAt after endAt", () => {
    const result = MetricDeriveRequestSchema.safeParse(
      baseRequest({
        startAt: "2026-04-02T01:00:00.000Z",
        endAt: "2026-04-02T00:00:00.000Z",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a range wider than the max span", () => {
    const result = MetricDeriveRequestSchema.safeParse(
      baseRequest({
        bucket: "1h",
        startAt: "2026-04-01T00:00:00.000Z",
        endAt: "2026-04-04T00:00:00.000Z",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects when the point count exceeds the cap (2d @ 10s)", () => {
    const result = MetricDeriveRequestSchema.safeParse(
      baseRequest({
        bucket: "10s",
        startAt: "2026-04-02T00:00:00.000Z",
        endAt: "2026-04-04T00:00:00.000Z",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("counts points by the aligned bucket axis, not (end-start)/bucket (off-by-one guard)", () => {
    // start/end 都不落桶边界：对齐补桶得 2001 个，旧的 floor(range/bucket)+1 只算 2000 会误放行。
    const result = MetricDeriveRequestSchema.safeParse(
      baseRequest({
        bucket: "10s",
        startAt: "2026-01-01T00:00:09.999Z",
        endAt: "2026-01-01T05:33:28.999Z",
      }),
    );
    expect(result.success).toBe(false);
  });
});
