import { describe, expect, it } from "vitest";
import { LlmOverviewQuerySchema, LlmTimeseriesQuerySchema } from "@kagami/metric-api/observability";

// 锁住 review 加固的契约护栏（Codex + Claude 对抗审查发现）：越界 offset / from>to / 桶数上限。
describe("LlmOverviewQuerySchema guards", () => {
  it("accepts a normal range", () => {
    expect(
      LlmOverviewQuerySchema.safeParse({
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-01T01:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects out-of-bounds offset that parses to Invalid Date", () => {
    expect(
      LlmOverviewQuerySchema.safeParse({
        from: "2026-01-01T00:00:00.000+99:00",
        to: "2026-01-01T01:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects from later than to", () => {
    expect(
      LlmOverviewQuerySchema.safeParse({
        from: "2026-01-02T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects a span beyond the max", () => {
    expect(
      LlmOverviewQuerySchema.safeParse({
        from: "2020-01-01T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("LlmTimeseriesQuerySchema guards", () => {
  it("accepts a normal range + bucket", () => {
    expect(
      LlmTimeseriesQuerySchema.safeParse({
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-01T01:00:00.000Z",
        bucket: "1m",
        metric: "calls",
      }).success,
    ).toBe(true);
  });

  it("rejects a huge span with a fine bucket (bucket-count DoS guard)", () => {
    expect(
      LlmTimeseriesQuerySchema.safeParse({
        from: "1970-01-01T00:00:00.000Z",
        to: "9999-01-01T00:00:00.000Z",
        bucket: "10s",
        metric: "calls",
      }).success,
    ).toBe(false);
  });

  it("rejects from later than to", () => {
    expect(
      LlmTimeseriesQuerySchema.safeParse({
        from: "2026-01-01T01:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
        bucket: "1m",
        metric: "calls",
      }).success,
    ).toBe(false);
  });
});
