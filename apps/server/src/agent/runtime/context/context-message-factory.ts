import type { Event } from "../event/event.js";
import { formatGroupMessagePlainText } from "../event/event.js";
import type { LlmMessage } from "../../../llm/types.js";
import {
  renderSupportedMessageSegments,
  type NapcatReceiveMessageSegment,
} from "../../../napcat/service/napcat-gateway/shared.js";

const BEIJING_TIME_ZONE = "Asia/Shanghai";

type UserMessage = Extract<LlmMessage, { role: "user" }>;
const CONVERSATION_SUMMARY_TAG = "conversation_summary";
const SYSTEM_REMINDER_TAG = "system_reminder";
const SYSTEM_INSTRUCTION_TAG = "system_instruction";

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
    `<${SYSTEM_REMINDER_TAG}>当前时间为北京时间 ${values.year} 年 ${values.month} 月 ${values.day} 日 ${values.hour}:${values.minute}</${SYSTEM_REMINDER_TAG}>`,
  );
}

export function createConversationSummaryMessage(summary: string): UserMessage {
  return createUserMessage(
    [`<${CONVERSATION_SUMMARY_TAG}>`, summary.trim(), `</${CONVERSATION_SUMMARY_TAG}>`].join("\n"),
  );
}

export function createPortalSnapshotMessage(
  groups: Array<{ groupId: string; unreadCount: number }>,
): UserMessage {
  const lines = [
    `<${SYSTEM_INSTRUCTION_TAG}>`,
    "你当前处于门户状态。",
    "这里只显示可进入的群 ID 和未读数；如果你想进入某个群，调用 enter_group。",
    "群列表：",
    ...groups.map(group => `- 群 ${group.groupId}，未读 ${group.unreadCount} 条`),
    `</${SYSTEM_INSTRUCTION_TAG}>`,
  ];

  return createUserMessage(lines.join("\n"));
}

export function createEnterGroupMessage(input: {
  groupId: string;
  source: "history" | "unread";
  hydratedCount: number;
}): UserMessage {
  const sourceLabel = input.source === "history" ? "最近历史消息" : "未读消息";
  return createUserMessage(
    [
      `<${SYSTEM_INSTRUCTION_TAG}>`,
      `你已进入群 ${input.groupId}。`,
      `接下来会看到该群补入的${sourceLabel}，本次共 ${input.hydratedCount} 条。`,
      "当前如果要发言，请在这个群里行动；如果想回到门户，调用 exit_group。",
      `</${SYSTEM_INSTRUCTION_TAG}>`,
    ].join("\n"),
  );
}

export function createExitGroupMessage(groupId: string): UserMessage {
  return createUserMessage(
    [
      `<${SYSTEM_INSTRUCTION_TAG}>`,
      `你已退出群 ${groupId}，回到门户状态。`,
      "现在不要直接发群消息；如需进入某个群，请调用 enter_group。",
      `</${SYSTEM_INSTRUCTION_TAG}>`,
    ].join("\n"),
  );
}

export function createWebSearchInstructionMessage(question: string): UserMessage {
  return createUserMessage(
    [
      `<${SYSTEM_INSTRUCTION_TAG}>`,
      "你正在继承主 agent 当前上下文，临时执行一次网页检索子任务。",
      "这次不是群聊发言决策，也不是直接回复群消息；本轮唯一目标是为主 agent 搜集信息，并给回一段可复用的中文摘要。",
      "你应该基于当前上下文理解这个问题在指什么，再决定搜索策略，而不是把问题孤立地当成一句无上下文文本。",
      `当前要检索的问题：${question.trim()}`,
      "你可以按需把问题拆成多个关键词或子问题，并多次调用 search_web_raw。",
      "如果信息已经足够，调用 finalize_web_search 输出最终摘要；摘要必须基于检索结果，且在证据不足、结果冲突或时间不明确时明确保留不确定性。",
      "不要直接输出自由文本回答，不要复述思考过程，只通过工具调用推进本轮任务。",
      `</${SYSTEM_INSTRUCTION_TAG}>`,
    ].join("\n"),
  );
}

export function createMessagesFromEvent(event: Event): UserMessage[] {
  switch (event.type) {
    case "napcat_group_message":
      if ((event.data.messageSegments?.length ?? 0) === 0) {
        return [];
      }

      return [
        createUserMessage(
          ["<qq_message>", renderGroupMessagePlainText(event.data), "</qq_message>"].join("\n"),
        ),
      ];
    default:
      return [];
  }
}

export function renderGroupMessagePlainText(input: {
  nickname: string;
  userId: string;
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
}): string {
  const renderedMessage = renderGroupMessageBody(input);
  return formatGroupMessagePlainText({
    nickname: input.nickname,
    userId: input.userId,
    rawMessage: renderedMessage,
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
