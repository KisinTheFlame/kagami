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
  groups: Array<{ groupId: string; groupName?: string; unreadCount: number; hasEntered: boolean }>,
): UserMessage {
  const lines = [
    `<${SYSTEM_REMINDER_TAG}>`,
    "你当前处于门户状态。",
    "这里会显示可进入的目标；如果你想进入某个目标，调用 enter。",
    "可进入目标：",
    ...groups.map(group => {
      const groupLabel = group.groupName
        ? `QQ 群 ${group.groupName}（${group.groupId}）`
        : `QQ 群 ${group.groupId}`;

      if (!group.hasEntered) {
        return `- ${groupLabel}，尚未查看，可通过 enter(kind="qq_group", id="${group.groupId}") 进去看看最近消息`;
      }

      return `- ${groupLabel}，未读 ${group.unreadCount} 条，可通过 enter(kind="qq_group", id="${group.groupId}") 进入`;
    }),
    '- 神游（kind="zone_out"），可通过 enter(kind="zone_out") 进入自由思考状态',
    `</${SYSTEM_REMINDER_TAG}>`,
  ];

  return createUserMessage(lines.join("\n"));
}

export function createEnterZoneOutMessage(): UserMessage {
  return createUserMessage(
    [
      `<${SYSTEM_INSTRUCTION_TAG}>`,
      "你已进入神游状态。",
      '现在不能看群消息，也不能直接搜索或发群消息；如果要继续思考，请调用 invoke(tool="zone_out", args={ thought: "..." })，如果想回到门户，调用 back_to_portal。',
      `</${SYSTEM_INSTRUCTION_TAG}>`,
    ].join("\n"),
  );
}

export function createExitZoneOutMessage(): UserMessage {
  return createUserMessage(
    [
      `<${SYSTEM_INSTRUCTION_TAG}>`,
      "你已结束神游，回到门户状态。",
      "如需进入某个目标，请调用 enter。",
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
