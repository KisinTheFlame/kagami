import type { MetricChartQueryResponse } from "@kagami/metric-api/chart";
import { describe, expect, it } from "vitest";
import { buildCacheRows } from "@/pages/dashboard/dashboard-cache";

function response(
  points: Array<{ bucketStart: string; value: number | null }>,
): MetricChartQueryResponse {
  return {
    bucket: "1m",
    startAt: "2026-04-02T00:00:00.000Z",
    endAt: "2026-04-02T00:02:00.000Z",
    series: points.length ? [{ key: "s", label: "s", points }] : [],
  };
}

const b0 = "2026-04-02T00:00:00.000Z";
const b1 = "2026-04-02T00:01:00.000Z";

describe("buildCacheRows", () => {
  it("aligns total tokens with the derived rate (× 100) by bucket", () => {
    const rows = buildCacheRows(
      response([
        { bucketStart: b0, value: 1000 },
        { bucketStart: b1, value: 2000 },
      ]),
      response([
        { bucketStart: b0, value: 0.999 },
        { bucketStart: b1, value: 0.95 },
      ]),
    );

    expect(rows.map(r => ({ tokens: r.tokens, ratePct: r.ratePct }))).toEqual([
      { tokens: 1000, ratePct: 99.9 },
      { tokens: 2000, ratePct: 95 },
    ]);
  });

  it("keeps rate null when the derive series has no value for a bucket (missing or divzero)", () => {
    const rows = buildCacheRows(
      response([
        { bucketStart: b0, value: 500 },
        { bucketStart: b1, value: 0 },
      ]),
      // b0 divzero → null; b1 absent from derive series entirely.
      response([{ bucketStart: b0, value: null }]),
    );

    expect(rows).toEqual([
      { bucketStart: b0, label: rows[0]?.label, tokens: 500, ratePct: null },
      { bucketStart: b1, label: rows[1]?.label, tokens: 0, ratePct: null },
    ]);
  });

  it("returns no rows when there is no total token data", () => {
    expect(buildCacheRows(response([]), response([{ bucketStart: b0, value: 0.9 }]))).toEqual([]);
  });
});
