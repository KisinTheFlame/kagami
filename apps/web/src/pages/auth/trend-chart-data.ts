import { type AuthProvider } from "@kagami/llm-api/auth";
import { type MetricPointsQueryResponse } from "@kagami/metric-api/points";

// 趋势图数据源已从旧 auth_usage_snapshot 专用管道切到通用 Metric raw 原始点端点（epic #521）：
// 每个 10 分钟采样点照画、不聚合。metric 名 / window tag 值与 apps/llm 打点侧约定一致。
export const OAUTH_QUOTA_REMAINING_PERCENT_METRIC = "llm.oauth.quota.remaining_percent";
export const WINDOW_TAG = "window";

export type TrendRange = "24h" | "7d";

// UI 的 24h / 7d 档映射到 raw 端点的 rangePreset（低频 gauge 无桶聚合，range 上限已放宽到 7 天）。
export const TREND_RANGE_TO_PRESET: Record<TrendRange, "1d" | "7d"> = {
  "24h": "1d",
  "7d": "7d",
};

/**
 * 用量趋势两条线按语义涂色，跨 provider 统一（DESIGN.md「一块色 = 一种含义」）：
 * 5 小时窗 = 短期配额消耗 → 玫红 --cost（高 token 成本）；7 天窗 = 长期基线 → 正蓝 --llm。
 * 此前按 provider 各配一套（claude-code 红 / codex 绿），把语义原色当成了品牌色。
 */
export const TREND_COLORS = {
  fiveHour: "hsl(var(--cost))",
  sevenDay: "hsl(var(--llm))",
} as const;

export type TrendChartRow = {
  occurredAt: string;
  five_hour: number | null;
  seven_day: number | null;
};

// 页面 provider（codex）对应打点侧的 provider tag（openai-codex）。
export function toMetricProviderTag(provider: AuthProvider): string {
  return provider === "codex" ? "openai-codex" : "claude-code";
}

export function buildTrendChartData(data: MetricPointsQueryResponse): TrendChartRow[] {
  const rows = new Map<string, TrendChartRow>();

  for (const series of data.series) {
    // groupByTag=window，series.key 是 window tag 值；只认已知的两个窗口。
    const windowKey = series.key === "five_hour" || series.key === "seven_day" ? series.key : null;
    if (!windowKey) {
      continue;
    }

    for (const point of series.points) {
      const existing =
        rows.get(point.occurredAt) ??
        ({
          occurredAt: point.occurredAt,
          five_hour: null,
          seven_day: null,
        } satisfies TrendChartRow);

      existing[windowKey] = point.value;
      rows.set(point.occurredAt, existing);
    }
  }

  return [...rows.values()].sort(
    (left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime(),
  );
}

export function formatTrendAxisTick(value: string, range: TrendRange): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    ...(range === "24h"
      ? {
          hour: "2-digit",
          minute: "2-digit",
        }
      : {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
        }),
  }).format(date);
}

export function formatTrendTooltipLabel(value: string, range: TrendRange): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(range === "7d" ? {} : { second: "2-digit" }),
  }).format(date);
}

export function getTrendWindowLabel(value: string): string {
  if (value === "five_hour") {
    return "5 小时";
  }

  if (value === "seven_day") {
    return "7 天";
  }

  return value;
}
