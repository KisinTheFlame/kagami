import type { SeriesMetaResolver } from "./MetricChartView";

/**
 * 小镜「状态时间占比」图的状态 → 展示元数据（label + 颜色）显式映射。
 *
 * 状态桶（互斥单轴，见后端 RootAgentSession.getCurrentStateTag）：
 * - 11 个 App（label 对齐后端 AppManager displayName）；
 * - `wait` = root loop 挂起（空闲等下一个生活输入）；
 * - `portal` = 桌面初始态（未进任何 App）。
 *
 * 配色遵循 DESIGN.md「颜色是配给」：`wait` 用语义黄（--scheduler = 等待/pending，唯一带明确语义
 * 的状态、也是最该被一眼看到的空闲带）；`portal` 用中性弱色；11 个 App 无专属语义 token，落
 * 「文艺复兴 / 印象派颜料」去饱和扩展色（DESIGN.md 图表扩展序列色的同族，无语义、不上墙）。
 *
 * ⚠️ 这套 App 配色需 DESIGN.md 签核；`wait`=黄、`portal`=中性两条先钉死。
 */
export const STATE_META: Record<string, { label: string; color: string }> = {
  // 语义状态
  wait: { label: "等待", color: "hsl(var(--scheduler))" },
  portal: { label: "桌面", color: "hsl(var(--muted-foreground))" },
  // 11 个 App（去饱和颜料色；label 对齐后端 displayName）
  qq: { label: "QQ", color: "#A85B54" },
  browser: { label: "浏览器", color: "#4E6A8A" },
  ithome: { label: "IT之家", color: "#C9892E" },
  hn: { label: "Hacker News", color: "#C2703D" },
  amap: { label: "高德地图", color: "#5F8A6B" },
  todo: { label: "待办", color: "#6B5D82" },
  calc: { label: "计算器", color: "#7A8B5A" },
  terminal: { label: "终端", color: "#4A5A5E" },
  clock: { label: "时钟", color: "#8A6D57" },
  spire: { label: "尖塔", color: "#7E5A8C" },
  pixel: { label: "像素画", color: "#B0894E" },
};

/**
 * 漂移兜底：后端新增 App 而这里未同步时，用中性色 + 原始 state id 作 label，
 * 保证不缺色/不崩（只是暂时没有专属配色，等补进 STATE_META）。
 */
export const STATE_FALLBACK = { label: "未知", color: "hsl(var(--muted-foreground))" } as const;

/** MetricChartView 的 seriesMeta 解析器：按状态 id 查 STATE_META，未命中回落到 STATE_FALLBACK。 */
export const stateSeriesMeta: SeriesMetaResolver = seriesKey => {
  const meta = STATE_META[seriesKey];
  if (meta) {
    return meta;
  }
  return { label: `${STATE_FALLBACK.label}（${seriesKey}）`, color: STATE_FALLBACK.color };
};
