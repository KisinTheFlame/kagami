import { describe, expect, it } from "vitest";
import {
  buildChartRows,
  buildPieData,
  type RenderSeries,
} from "@/components/metric/MetricChartView";

// 图表类型适配器的纯数据变换（#475 P4）：line/bar/stacked 共用「桶 × 序列」矩阵，pie 塌成每序列一值。

const series: RenderSeries[] = [
  {
    key: "Read",
    label: "Read",
    dataKey: "series_0",
    points: [
      { bucketStart: "2026-04-02T00:00:00.000Z", value: 2 },
      { bucketStart: "2026-04-02T00:01:00.000Z", value: 3 },
    ],
  },
  {
    key: "Wait",
    label: "Wait",
    dataKey: "series_1",
    points: [
      { bucketStart: "2026-04-02T00:00:00.000Z", value: 5 },
      { bucketStart: "2026-04-02T00:01:00.000Z", value: null },
    ],
  },
];

describe("buildPieData", () => {
  it("collapses each series to the sum of its points (null counted as 0) with a stable dataKey", () => {
    const slices = buildPieData(series);
    expect(slices).toEqual([
      { dataKey: "series_0", name: "Read", value: 5, fill: "hsl(var(--llm))" },
      { dataKey: "series_1", name: "Wait", value: 5, fill: "hsl(var(--signal))" },
    ]);
  });

  it("takes the absolute magnitude so negative series still render a slice", () => {
    const negative: RenderSeries[] = [
      {
        key: "delta",
        label: "delta",
        dataKey: "series_0",
        points: [
          { bucketStart: "2026-04-02T00:00:00.000Z", value: -7 },
          { bucketStart: "2026-04-02T00:01:00.000Z", value: 2 },
        ],
      },
    ];
    // sum = -5 → 绝对量 5（饼图切片不能是负角度）。
    expect(buildPieData(negative)[0]?.value).toBe(5);
  });

  it("assigns a distinct fill per slice from the series palette", () => {
    const slices = buildPieData(series);
    expect(slices[0]?.fill).toBe("hsl(var(--llm))");
    expect(slices[1]?.fill).toBe("hsl(var(--signal))");
    expect(slices[0]?.fill).not.toBe(slices[1]?.fill);
  });
});

describe("buildChartRows", () => {
  it("pivots series into per-bucket rows keyed by dataKey, sorted by bucketStart", () => {
    const rows = buildChartRows(series);
    expect(rows).toEqual([
      {
        bucketLabel: rows[0]?.bucketLabel,
        bucketStart: "2026-04-02T00:00:00.000Z",
        series_0: 2,
        series_1: 5,
      },
      {
        bucketLabel: rows[1]?.bucketLabel,
        bucketStart: "2026-04-02T00:01:00.000Z",
        series_0: 3,
        series_1: null,
      },
    ]);
  });
});
