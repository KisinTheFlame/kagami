import type { Event } from "../agent/event.js";
import { formatGroupMessagePlainText } from "../agent/event.js";
import type { LlmMessage } from "../llm/types.js";

const BEIJING_TIME_ZONE = "Asia/Shanghai";

type UserMessage = Extract<LlmMessage, { role: "user" }>;
const CONVERSATION_SUMMARY_TAG = "conversation_summary";

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
    `<system_reminder>当前时间为北京时间 ${values.year} 年 ${values.month} 月 ${values.day} 日 ${values.hour}:${values.minute}</system_reminder>`,
  );
}

export function createConversationSummaryMessage(summary: string): UserMessage {
  return createUserMessage(
    [`<${CONVERSATION_SUMMARY_TAG}>`, summary.trim(), `</${CONVERSATION_SUMMARY_TAG}>`].join("\n"),
  );
}

export function isConversationSummaryMessage(message: LlmMessage | undefined): boolean {
  if (message?.role !== "user" || typeof message.content !== "string") {
    return false;
  }

  return (
    message.content.startsWith(`<${CONVERSATION_SUMMARY_TAG}>`) &&
    message.content.includes(`</${CONVERSATION_SUMMARY_TAG}>`)
  );
}

export function createMessagesFromEvent(event: Event): UserMessage[] {
  switch (event.type) {
    case "napcat_group_message":
      return [
        createUserMessage(
          ["<message>", formatGroupMessagePlainText(event), "</message>"].join("\n"),
        ),
      ];
    default:
      return [];
  }
}
