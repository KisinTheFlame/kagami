import type { MetricChartQueryResponse } from "@kagami/metric-api/chart";
import { describe, expect, it } from "vitest";
import { mergeToolSeries } from "@/pages/dashboard/dashboard-series";

function response(
  points: Array<{ bucketStart: string; value: number | null }>,
): MetricChartQueryResponse {
  return {
    bucket: "1m",
    startAt: "2026-04-02T00:00:00.000Z",
    endAt: "2026-04-02T00:02:00.000Z",
    series: points.length ? [{ key: "__default__", label: "agent.tool.call", points }] : [],
  };
}

const b0 = "2026-04-02T00:00:00.000Z";
const b1 = "2026-04-02T00:01:00.000Z";

describe("mergeToolSeries", () => {
  it("overlays two single-series responses into one two-series response", () => {
    const merged = mergeToolSeries([
      {
        label: "所有工具",
        data: response([
          { bucketStart: b0, value: 5 },
          { bucketStart: b1, value: 3 },
        ]),
      },
      {
        label: "Wait 工具",
        data: response([
          { bucketStart: b0, value: 2 },
          { bucketStart: b1, value: 1 },
        ]),
      },
    ]);

    expect(merged?.series).toEqual([
      {
        key: "s0",
        label: "所有工具",
        points: [
          { bucketStart: b0, value: 5 },
          { bucketStart: b1, value: 3 },
        ],
      },
      {
        key: "s1",
        label: "Wait 工具",
        points: [
          { bucketStart: b0, value: 2 },
          { bucketStart: b1, value: 1 },
        ],
      },
    ]);
  });

  it("fills a series with zeros along the other series' axis when it has no data", () => {
    const merged = mergeToolSeries([
      {
        label: "所有工具",
        data: response([
          { bucketStart: b0, value: 4 },
          { bucketStart: b1, value: 2 },
        ]),
      },
      { label: "Wait 工具", data: response([]) }, // Wait 工具本区间零次调用
    ]);

    expect(merged?.series[1]).toEqual({
      key: "s1",
      label: "Wait 工具",
      points: [
        { bucketStart: b0, value: 0 },
        { bucketStart: b1, value: 0 },
      ],
    });
  });

  it("returns undefined when neither series has data", () => {
    const merged = mergeToolSeries([
      { label: "所有工具", data: response([]) },
      { label: "Wait 工具", data: response([]) },
    ]);
    expect(merged).toBeUndefined();
  });
});
