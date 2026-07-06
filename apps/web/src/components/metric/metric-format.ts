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
