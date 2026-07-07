import { describe, expect, it } from "vitest";
import {
  buildChartRows,
  buildPieData,
  densifyRows,
  type RenderSeries,
} from "@/components/metric/MetricChartView";

const b0 = "2026-07-07T00:00:00.000Z";
const b1 = "2026-07-07T00:05:00.000Z";

function series(
  key: string,
  color: string,
  points: Array<{ bucketStart: string; value: number | null }>,
  index: number,
): RenderSeries {
  return { key, label: key, color, dataKey: `series_${index}`, points };
}

describe("densifyRows（堆叠面积 100% 归一前的补 0）", () => {
  it("把每桶里缺失的序列补 0，避免 stackOffset=expand 分母漏掉 0 采样的状态", () => {
    // qq 在 b0/b1 都有；wait 只在 b1 有 → b0 缺 wait，densify 应补 0。
    const renderSeries: RenderSeries[] = [
      series(
        "qq",
        "#A85B54",
        [
          { bucketStart: b0, value: 3 },
          { bucketStart: b1, value: 1 },
        ],
        0,
      ),
      series("wait", "hsl(var(--scheduler))", [{ bucketStart: b1, value: 5 }], 1),
    ];
    const rows = buildChartRows(renderSeries);
    const dense = densifyRows(rows, renderSeries);

    const row0 = dense.find(r => r.bucketStart === b0);
    // b0：qq=3，wait 原本缺失（undefined）→ 补 0。
    expect(row0?.series_0).toBe(3);
    expect(row0?.series_1).toBe(0);

    const row1 = dense.find(r => r.bucketStart === b1);
    expect(row1?.series_0).toBe(1);
    expect(row1?.series_1).toBe(5);
  });

  it("不改原 rows（返回新对象）", () => {
    const renderSeries: RenderSeries[] = [
      series("portal", "#000", [{ bucketStart: b0, value: 2 }], 0),
      series("qq", "#A85B54", [{ bucketStart: b1, value: 4 }], 1),
    ];
    const rows = buildChartRows(renderSeries);
    const before = JSON.stringify(rows);
    densifyRows(rows, renderSeries);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("buildPieData 用解析后的 color", () => {
  it("切片 fill 取 series.color（显式映射），而非 index 轮转", () => {
    const renderSeries: RenderSeries[] = [
      series("wait", "hsl(var(--scheduler))", [{ bucketStart: b0, value: 10 }], 0),
    ];
    const pie = buildPieData(renderSeries);
    expect(pie[0]?.fill).toBe("hsl(var(--scheduler))");
    expect(pie[0]?.value).toBe(10);
  });
});
