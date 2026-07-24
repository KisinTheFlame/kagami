import type { SeriesMetaResolver } from "./MetricChartView";

/**
 * 小镜「状态时间占比」图里两个语义状态的展示 pin（label + 颜色）。
 *
 * 只钉 DESIGN.md 要求显式配色的两个语义状态：
 * - `wait` = root loop 挂起（空闲等下一个生活输入），语义黄（--scheduler = 等待/pending），
 *   是最该被一眼扫到的空闲带（也恒堆在最顶，见 DashboardPage 的 pinSeriesToTop）；
 * - `portal` = 桌面初始态（未进任何 App），中性弱色。
 *
 * 其余状态（各 App）不再维护名字/配色映射：图例回落到后端返回的原始 state tag（如 "qq"/"gba"），
 * 颜色走 MetricChartView 的 seriesColors 轮转。新增 App 零维护，绝不再显示「未知」。
 */
const STATE_META: Record<string, { label: string; color: string }> = {
  wait: { label: "等待", color: "hsl(var(--scheduler))" },
  portal: { label: "桌面", color: "hsl(var(--muted-foreground))" },
};

/**
 * MetricChartView 的 seriesMeta 解析器：只对 wait/portal 显式给 label + 颜色；
 * 其余状态返回 undefined → 回落到后端原始 tag 作 label + seriesColors 轮转色。
 */
export const stateSeriesMeta: SeriesMetaResolver = seriesKey => STATE_META[seriesKey];
