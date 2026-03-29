import type { Event } from "../event/event.js";
import type { LlmMessage } from "../../../llm/types.js";
import {
  renderSupportedMessageSegments,
  type NapcatReceiveMessageSegment,
} from "../../../napcat/service/napcat-gateway/shared.js";
import type { NapcatGroupMessageData } from "../../../napcat/service/napcat-gateway.service.js";
import { renderServerStaticTemplate } from "../../../common/runtime/read-static-text.js";

const BEIJING_TIME_ZONE = "Asia/Shanghai";

type UserMessage = Extract<LlmMessage, { role: "user" }>;

export function createUserMessage(content: string): UserMessage {
  return {
    role: "user",
    content,
  };
}

export function createWakeReminderMessage(now: Date): UserMessage {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/wake-reminder.hbs", values),
  );
}

export function createConversationSummaryMessage(summary: string): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/conversation-summary.hbs", {
      summary: summary.trim(),
    }),
  );
}

export function createPortalSnapshotMessage(
  groups: Array<{ groupId: string; groupName?: string; unreadCount: number; hasEntered: boolean }>,
): UserMessage {
  const renderedGroups = groups.map(group => {
    const groupLabel = group.groupName
      ? `QQ 群 ${group.groupName}（${group.groupId}）`
      : `QQ 群 ${group.groupId}`;

    return {
      ...group,
      groupLabel,
      enterCommandText: `enter(kind="qq_group", id="${group.groupId}")`,
    };
  });

  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/portal-snapshot.hbs", {
      groups: renderedGroups,
    }),
  );
}

export function createEnterZoneOutMessage(): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/enter-zone-out.hbs"),
  );
}

export function createExitZoneOutMessage(): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/exit-zone-out.hbs"),
  );
}

export function createWebSearchInstructionMessage(question: string): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/web-search-instruction.hbs", {
      question: question.trim(),
    }),
  );
}

export function createMessagesFromEvent(event: Event): UserMessage[] {
  switch (event.type) {
    case "napcat_group_message":
      if ((event.data.messageSegments?.length ?? 0) === 0) {
        return [];
      }

      return [createUserMessage(renderGroupMessagePlainText(event.data))];
    default:
      return [];
  }
}

export function createMergedGroupMessagesMessage(
  messages: NapcatGroupMessageData[],
): UserMessage | null {
  if (messages.length === 0) {
    return null;
  }

  return createUserMessage(
    messages.map(message => renderGroupMessagePlainText(message)).join("\n\n"),
  );
}

export function renderGroupMessagePlainText(input: {
  nickname: string;
  userId: string;
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
}): string {
  const renderedMessage = renderGroupMessageBody(input);
  return renderServerStaticTemplate(import.meta.url, "context/qq-message.hbs", {
    nickname: input.nickname,
    userId: input.userId,
    messageBody: renderedMessage,
  });
}

function renderGroupMessageBody(input: {
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
}): string {
  const segments = input.messageSegments ?? [];
  if (segments.length === 0) {
    return "";
  }

  const rendered = renderSupportedMessageSegments(segments);
  return rendered;
}
