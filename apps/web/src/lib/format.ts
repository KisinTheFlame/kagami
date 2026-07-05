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

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * 把字节数格式化为人类可读（1024 进制，保留至多 2 位小数，去掉尾随 0）。
 * 负数 / 非有限值一律回退成 `0 B`。用于 OSS 对象大小与存储统计展示。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const rounded = Math.round(value * 100) / 100;
  return `${rounded} ${BYTE_UNITS[exponent]}`;
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
