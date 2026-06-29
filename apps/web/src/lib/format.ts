const DATE_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

/**
 * 把 ISO 字符串格式化为 zh-CN 的「年/月/日 时:分:秒」（2 位补零）。
 * 调用方需保证 value 为合法时间字符串；非法输入会原样返回 `Invalid Date`，
 * 与历史各页 `formatDate` 的行为一致。需要容忍空值/非法值时用
 * {@link formatOptionalDateTime}。
 */
export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", DATE_TIME_FORMAT_OPTIONS);
}

/**
 * 与 {@link formatDateTime} 同样的展示格式，但容忍 null/undefined/非法时间：
 * 这些情况返回 `fallback`（默认 `"—"`）。
 */
export function formatOptionalDateTime(value: string | null | undefined, fallback = "—"): string {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toLocaleString("zh-CN", DATE_TIME_FORMAT_OPTIONS);
}
