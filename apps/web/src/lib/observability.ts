import type { ObservabilityBucket } from "@kagami/metric-api/observability";

// 观察台前端共用小工具：时间范围、分桶推导、系列配色、下钻 URL。
// 刻意保持「一堆纯函数」而非「图表引擎」——渐进式披露，别过度抽象（见设计文档 Codex 反驳）。

export type RangePresetKey = "15m" | "1h" | "6h" | "24h" | "2d";

export const RANGE_PRESETS: readonly { key: RangePresetKey; label: string; ms: number }[] = [
  { key: "15m", label: "近 15 分钟", ms: 15 * 60 * 1000 },
  { key: "1h", label: "近 1 小时", ms: 60 * 60 * 1000 },
  { key: "6h", label: "近 6 小时", ms: 6 * 60 * 60 * 1000 },
  { key: "24h", label: "近 24 小时", ms: 24 * 60 * 60 * 1000 },
  { key: "2d", label: "近 2 天", ms: 2 * 24 * 60 * 60 * 1000 },
];

/**
 * 按时间跨度推导一个「桶数适中（~50-100 个点）」的分桶粒度。观察台不暴露 bucket 选择器
 * ——粒度由范围自动决定，UI 更干净。跨度越大桶越粗。
 */
export function deriveBucket(spanMs: number): ObservabilityBucket {
  if (spanMs <= 30 * 60 * 1000) return "10s";
  if (spanMs <= 2 * 60 * 60 * 1000) return "1m";
  if (spanMs <= 12 * 60 * 60 * 1000) return "5m";
  if (spanMs <= 2 * 24 * 60 * 60 * 1000) return "30m";
  return "1h";
}

export function bucketMillis(bucket: ObservabilityBucket): number {
  switch (bucket) {
    case "10s":
      return 10 * 1000;
    case "1m":
      return 60 * 1000;
    case "5m":
      return 5 * 60 * 1000;
    case "30m":
      return 30 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
  }
}

// 系列配色：前 4 条走 DESIGN.md 语义原色 token，第 5 条起回落到去饱和扩展色（无语义、仅图表）。
export const SERIES_COLORS: readonly string[] = [
  "hsl(var(--llm))",
  "hsl(var(--signal))",
  "hsl(var(--story))",
  "hsl(var(--cost))",
  "#C9892E",
  "#3F6B68",
  "#6B5D82",
  "#8A5A38",
];

export function seriesColorAt(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

export type LlmHistoryDrillTarget = {
  provider?: string;
  model?: string;
  status?: "success" | "failed";
  from?: string;
  to?: string;
};

/** 拼下钻到 LLM 调用历史页的 URL：把上下文（model/provider/时间窗）带成 query 落地明细。 */
export function buildLlmHistoryDrillUrl(target: LlmHistoryDrillTarget): string {
  const params = new URLSearchParams();
  if (target.provider) params.set("provider", target.provider);
  if (target.model) params.set("model", target.model);
  if (target.status) params.set("status", target.status);
  if (target.from) params.set("from", target.from);
  if (target.to) params.set("to", target.to);
  const query = params.toString();
  return query.length > 0 ? `/llm-history?${query}` : "/llm-history";
}
