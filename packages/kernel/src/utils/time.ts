/** 小镜的生活时区（北京）。所有面向用户的时间展示统一走这个时区，别在各处重复字面量。 */
export const BEIJING_TIME_ZONE = "Asia/Shanghai";

/**
 * 把 Date 格式化成北京时区的 `zh-CN` 年月日时分（24 小时制、分钟补零）。各 App 屏幕
 * （HN / IThome …）与上下文时间展示共用同一份，保证进 LLM 上下文的时间文案格式一致。
 */
export function formatBeijingDateTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}
