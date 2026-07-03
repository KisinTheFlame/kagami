import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import {
  renderSupportedMessageSegments,
  type NapcatReceiveMessageSegment,
} from "../../../napcat/application/napcat-gateway/shared.js";
import type { GroupNoticeMessage } from "../../capabilities/messaging/conversation.js";

// === QQ App 群/私聊消息渲染 ===
// 把 napcat 收到的消息段渲染成给 LLM 阅读的 <qq_message> 纯文本。QQ / napcat 概念
// 只属于 QQ App，不外泄到 runtime。

export function renderGroupMessagePlainText(input: {
  nickname: string;
  userId: string;
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
  messageId?: number | null;
}): string {
  return renderQqMessagePlainText({
    displayName: input.nickname,
    userId: input.userId,
    rawMessage: input.rawMessage,
    messageSegments: input.messageSegments,
    messageId: input.messageId,
  });
}

export function renderPrivateMessagePlainText(input: {
  nickname: string;
  remark: string | null;
  userId: string;
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
  messageId?: number | null;
}): string {
  return renderQqMessagePlainText({
    displayName: formatPrivateChatDisplayName(input),
    userId: input.userId,
    rawMessage: input.rawMessage,
    messageSegments: input.messageSegments,
    messageId: input.messageId,
  });
}

function formatPrivateChatDisplayName(input: {
  nickname: string;
  remark: string | null;
  userId: string;
}): string {
  const remark = input.remark?.trim();
  if (remark) {
    return remark;
  }

  const nickname = input.nickname.trim();
  if (nickname) {
    return nickname;
  }

  return input.userId;
}

function renderQqMessagePlainText(input: {
  displayName: string;
  userId: string;
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
  messageId?: number | null;
}): string {
  const renderedMessage = renderQqMessageBody(input);
  return renderServerStaticTemplate(import.meta.url, "context/qq-message.hbs", {
    nickname: input.displayName,
    userId: input.userId,
    messageBody: renderedMessage,
    // 暴露 QQ message_id 作为「回复哪条」的句柄；缺失时模板不渲染 id 属性。
    messageId: input.messageId ?? null,
  });
}

function renderQqMessageBody(input: {
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
}): string {
  const segments = input.messageSegments ?? [];
  if (segments.length === 0) {
    return input.rawMessage.trim();
  }

  const rendered = renderSupportedMessageSegments(segments);
  return rendered;
}

/**
 * 渲染群禁言 / 解禁通知（六形态一个模板）。TS 只算 view-model（布尔 + 预格式化的名字/时长），
 * 文案结构在 qq-notice.hbs。`bare=true` 输出不带 `<qq_notice>` 标签的裸正文，供通知预览用
 * （预览行自身已有 QQ 通知格式包裹）。名字查不到退化裸 QQ 号；operator 缺失退化为「管理员」。
 */
export function renderGroupNoticePlainText(
  notice: GroupNoticeMessage,
  options?: { bare?: boolean },
): string {
  return renderServerStaticTemplate(import.meta.url, "context/qq-notice.hbs", {
    bare: options?.bare ?? false,
    isBan: notice.noticeType === "ban",
    wholeGroup: notice.wholeGroup,
    selfTargeted: notice.selfTargeted,
    operator: formatBanParticipant(notice.operatorName, notice.operatorUserId, "管理员"),
    target: formatBanParticipant(notice.targetName, notice.targetUserId, "某成员"),
    duration: formatMuteDuration(notice.durationSeconds),
  });
}

/** 禁言参与者显示：`名字(QQ)`；名字缺失退化裸号；号也缺失用兜底词（operator→管理员）。 */
function formatBanParticipant(
  name: string | null,
  userId: string | null,
  fallback: string,
): string {
  if (!userId) {
    return fallback;
  }
  const trimmed = name?.trim();
  return trimmed ? `${trimmed}(${userId})` : userId;
}

/**
 * 禁言时长（秒）→ 中文。天/小时/分钟里取非零单位拼接（"1 小时 30 分钟"）；全为零（<60 秒，
 * QQ 正常不出现，仅 duration 畸形降级 0 的边界）退化为 "N 秒"。
 */
export function formatMuteDuration(seconds: number): string {
  const total = Math.max(0, Math.trunc(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} 天`);
  }
  if (hours > 0) {
    parts.push(`${hours} 小时`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} 分钟`);
  }
  if (parts.length === 0) {
    return `${total} 秒`;
  }
  return parts.join(" ");
}
