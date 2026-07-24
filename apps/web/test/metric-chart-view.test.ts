import { describe, expect, it } from "vitest";
import {
  buildChartRows,
  buildPieData,
  orderSeriesForStack,
  selectVisibleSeries,
  type RenderSeries,
} from "@/components/metric/MetricChartView";

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

describe("selectVisibleSeries：仅过滤、不重排不串色", () => {
  const s0 = series("wait", "c0", [{ bucketStart: b0, value: 1 }], 0);
  const s1 = series("app", "c1", [{ bucketStart: b0, value: 2 }], 1);
  const s2 = series("portal", "c2", [{ bucketStart: b0, value: 3 }], 2);
  const all: RenderSeries[] = [s0, s1, s2];

  it("空隐藏集 → 全量原样", () => {
    expect(selectVisibleSeries(all, new Set())).toEqual(all);
  });

  it("隐藏中间项：剩余序列 dataKey / color / 顺序不变", () => {
    const visible = selectVisibleSeries(all, new Set(["app"]));
    expect(visible.map(s => s.key)).toEqual(["wait", "portal"]);
    // 关键：series_0 / series_2 与颜色纹丝不动，绝不因过滤重编号成 series_0 / series_1。
    expect(visible.map(s => s.dataKey)).toEqual(["series_0", "series_2"]);
    expect(visible.map(s => s.color)).toEqual(["c0", "c2"]);
  });

  it("全部隐藏 → 空数组", () => {
    expect(selectVisibleSeries(all, new Set(["wait", "app", "portal"]))).toEqual([]);
  });

  it("残留 stale key（不在序列里）→ 无害 no-op", () => {
    expect(selectVisibleSeries(all, new Set(["gone"]))).toEqual(all);
  });
});

describe("orderSeriesForStack：pin 移末位 = 堆叠视觉最顶，不改 dataKey/color", () => {
  const s0 = series("qq", "c0", [{ bucketStart: b0, value: 1 }], 0);
  const s1 = series("wait", "c1", [{ bucketStart: b0, value: 2 }], 1);
  const s2 = series("portal", "c2", [{ bucketStart: b0, value: 3 }], 2);
  const all: RenderSeries[] = [s0, s1, s2];

  it("pinKey 存在：移到末位，其余保持原相对顺序", () => {
    const ordered = orderSeriesForStack(all, "wait");
    expect(ordered.map(s => s.key)).toEqual(["qq", "portal", "wait"]);
  });

  it("重排不改 dataKey / color（随 dataKey 走色，绝不串色）", () => {
    const ordered = orderSeriesForStack(all, "wait");
    const waitEntry = ordered.at(-1);
    expect(waitEntry?.key).toBe("wait");
    // wait 原来是 series_1 / c1，移位后依旧。
    expect(waitEntry?.dataKey).toBe("series_1");
    expect(waitEntry?.color).toBe("c1");
    // qq 仍是 series_0 / c0。
    expect(ordered[0]?.dataKey).toBe("series_0");
    expect(ordered[0]?.color).toBe("c0");
  });

  it("pinKey 缺省：原样返回（顺序不变）", () => {
    expect(orderSeriesForStack(all).map(s => s.key)).toEqual(["qq", "wait", "portal"]);
  });

  it("pinKey 不在序列里：原样返回（顺序不变，无害 no-op）", () => {
    expect(orderSeriesForStack(all, "gone").map(s => s.key)).toEqual(["qq", "wait", "portal"]);
  });

  it("pin 已在末位：仍是末位（幂等）", () => {
    expect(orderSeriesForStack(all, "portal").map(s => s.key)).toEqual(["qq", "wait", "portal"]);
  });
});

describe("几何按可见集重算：隐藏项被排除", () => {
  const b1 = "2026-07-07T00:01:00.000Z";
  const s0 = series(
    "wait",
    "c0",
    [
      { bucketStart: b0, value: 1 },
      { bucketStart: b1, value: 4 },
    ],
    0,
  );
  const s1 = series(
    "app",
    "c1",
    [
      { bucketStart: b0, value: 2 },
      { bucketStart: b1, value: 5 },
    ],
    1,
  );

  it("buildChartRows：隐藏序列的列从行里消失", () => {
    const visible = selectVisibleSeries([s0, s1], new Set(["app"]));
    const rows = buildChartRows(visible);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.series_0).toBe(1);
    // 隐藏的 app（series_1）列不该出现在行数据里。
    expect("series_1" in (rows[0] ?? {})).toBe(false);
  });

  it("buildPieData + total：隐藏切片消失、总量按可见项重算", () => {
    const full = buildPieData([s0, s1]);
    const fullTotal = full.reduce((sum, slice) => sum + slice.value, 0);
    expect(fullTotal).toBe(1 + 4 + 2 + 5); // 12

    const visible = buildPieData(selectVisibleSeries([s0, s1], new Set(["app"])));
    expect(visible.map(slice => slice.name)).toEqual(["wait"]);
    const visibleTotal = visible.reduce((sum, slice) => sum + slice.value, 0);
    expect(visibleTotal).toBe(1 + 4); // 5，不再含 app
  });
});
