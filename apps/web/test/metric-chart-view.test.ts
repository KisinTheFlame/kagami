import { describe, expect, it } from "vitest";
import { buildPieData, type RenderSeries } from "@/components/metric/MetricChartView";

const b0 = "2026-07-07T00:00:00.000Z";

function series(
  key: string,
  color: string,
  points: Array<{ bucketStart: string; value: number | null }>,
  index: number,
): RenderSeries {
  return { key, label: key, color, dataKey: `series_${index}`, points };
}

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
