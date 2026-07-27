import type { RaiseAlertRequest } from "@kagami/observatory-api/alert";

/**
 * `detail` 的渲染上限，按 **Unicode 码点**计。
 *
 * 必须按码点而不是 UTF-16 code unit：本仓库踩过这个坑——issue #187 的 lone surrogate 事故就是
 * 按 UTF-16 `slice` 把代理对劈成半个字符。这里的文本虽然不进 LLM 上下文，同一类 bug 会让告警群
 * 收到半个 emoji。
 */
const DETAIL_MAX_CODE_POINTS = 1500;

/** 时区固定东八区：告警是给人看的，人在这个时区。 */
const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * 渲染一条告警成 QQ 群消息文本。纯函数。
 *
 * 这里的散文**不走 `.hbs` 模板**：CLAUDE.md 那条硬约束限定「最终会进 LLM 上下文的成句文案」，
 * 而告警群对小镜是屏蔽的（`server.napcat.blockedGroupIds`），这些文本永不进她的上下文。
 *
 * `suppressedSinceLast` > 0 时在末行说明「上一条同类告警之后还有多少次被去重窗口压制」，
 * 让人知道这条告警背后不止一次。
 */
export function renderAlertMessage(input: {
  alert: RaiseAlertRequest;
  occurredAt: Date;
  suppressedSinceLast: number;
}): string {
  const { alert, occurredAt, suppressedSinceLast } = input;
  const lines: string[] = [`【${alert.severity}】${alert.source} · ${alert.event}`, alert.title];

  const detail = alert.detail?.trim();
  if (detail) {
    lines.push(truncateByCodePoints(detail, DETAIL_MAX_CODE_POINTS));
  }

  for (const [key, value] of Object.entries(alert.context ?? {})) {
    lines.push(`${key}: ${String(value)}`);
  }

  lines.push(formatTimestamp(occurredAt));

  if (suppressedSinceLast > 0) {
    lines.push(`距上次同类告警之间另有 ${suppressedSinceLast} 次被压制。`);
  }

  return lines.join("\n");
}

/** 按 Unicode 码点截断（`[...text]` 按码点分割，不会劈开代理对）。超长时以 `…` 收尾。 */
function truncateByCodePoints(text: string, maxCodePoints: number): string {
  const codePoints = [...text];
  if (codePoints.length <= maxCodePoints) {
    return text;
  }

  return `${codePoints.slice(0, maxCodePoints).join("")}…`;
}

function formatTimestamp(occurredAt: Date): string {
  const parts = TIMESTAMP_FORMATTER.formatToParts(occurredAt);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}
