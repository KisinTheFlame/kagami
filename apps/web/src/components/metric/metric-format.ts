// metric 图表共享的格式化助手（从 MetricChartView 抽出，供大盘 composed 图等复用）。

/** 桶起点 → 轴标签（月-日 时:分）。 */
export function formatBucketLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** 桶起点 → tooltip 完整时间（年-月-日 时:分:秒）。 */
export function formatFullDateTime(value: string): string {
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
    second: "2-digit",
  }).format(date);
}

/**
 * 数值 → 紧凑单位（K/M/B）。给轴刻度用：token 动辄百万，裸数字带千分位会撑爆窄轴。
 * 1,435,008 → "1.44M"、435,008 → "435K"、8.1 → "8.1"。tooltip 仍用 formatMetricValue 显精确值。
 */
export function formatCompactNumber(value: number | string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }
  const abs = Math.abs(value);
  if (abs >= 1e9) {
    return trimTrailingZeros(value / 1e9) + "B";
  }
  if (abs >= 1e6) {
    return trimTrailingZeros(value / 1e6) + "M";
  }
  if (abs >= 1e3) {
    return trimTrailingZeros(value / 1e3) + "K";
  }
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function trimTrailingZeros(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

/** 数值 → 轴/tooltip 显示（≥1000 千分位、否则最多两位小数）。 */
export function formatMetricValue(value: number | string): string {
  if (typeof value !== "number") {
    return String(value);
  }

  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("zh-CN", {
      maximumFractionDigits: 1,
    });
  }

  return value.toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
}
