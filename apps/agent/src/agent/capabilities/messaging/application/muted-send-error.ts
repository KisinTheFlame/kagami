/**
 * 出站发送因禁言被拦时抛的类型化错误。guard 收口在 DefaultAgentMessageService（单咽喉点，
 * 覆盖 send_message / send_resource / 管理台直发三条路径）；各 catch 边界（两个工具 + HTTP
 * handler）识别它并翻译成各自的错误响应。携带 reason / untilEpochMs，让翻译点能就地格式化文案。
 */
export type MutedSendReason = "self" | "whole";

export class MutedSendError extends Error {
  public readonly reason: MutedSendReason;
  /** self 禁言到期毫秒时间戳；whole（全员禁言，无到期）时为 undefined。 */
  public readonly untilEpochMs?: number;

  public constructor(reason: MutedSendReason, untilEpochMs?: number) {
    super(reason === "self" ? "被禁言，暂时不能在该群发送" : "全员禁言中，暂时不能在该群发送");
    this.name = "MutedSendError";
    this.reason = reason;
    this.untilEpochMs = untilEpochMs;
  }
}

/**
 * 禁言提示文案（工具 result error note，按 CLAUDE.md 例外留 TS 常量）。self 带到期时间
 * （MM-dd HH:mm，服务器本地时区 = 部署机北京时间）；whole 无到期。
 */
export function formatMutedNote(error: MutedSendError): string {
  if (error.reason === "whole") {
    return "这个群正在全员禁言中，解除前发不了消息。";
  }
  if (error.untilEpochMs !== undefined) {
    return `你在这个群正被禁言，到 ${formatMuteUntil(error.untilEpochMs)} 才能说话。`;
  }
  return "你在这个群正被禁言，暂时发不了消息。";
}

/** 毫秒时间戳 → "MM-dd HH:mm"（本地时区）。 */
export function formatMuteUntil(epochMs: number): string {
  const date = new Date(epochMs);
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${month}-${day} ${hour}:${minute}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
