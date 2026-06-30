import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import {
  renderSupportedMessageSegments,
  type NapcatReceiveMessageSegment,
} from "../../../napcat/application/napcat-gateway/shared.js";

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
