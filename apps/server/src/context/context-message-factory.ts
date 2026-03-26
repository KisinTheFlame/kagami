import type { Event } from "../event/event.js";
import { formatGroupMessagePlainText } from "../event/event.js";
import type { LlmMessage } from "../llm/types.js";
import {
  formatAtSegment,
  formatImageSegmentText,
  type NapcatReceiveMessageSegment,
} from "../service/napcat-gateway/shared.js";

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

export function createReplyDecisionReminderMessage(): UserMessage {
  return createUserMessage(
    [
      "<system_reminder>",
      "你正在对主 agent 提交的发言申请做最终裁决。",
      "默认倾向是不发送。只有当现在发出去明显比沉默更自然时，才把 shouldSend 设为 true。",
      "申请不等于必须发送；即使主 agent 想接，也要由你最终判断是否真的该发。",
      "只有在这些情况明显成立时，才值得发送：被直接 @ 或点名；最近 1 到 3 条里有非常顺手的梗；存在一句话就能自然接上的明确切口；不说反而显得奇怪。",
      "如果更像主动找话题、需要解释超过两句、只是重复别人刚说过的话、或只是轻微改写现成观点，就应倾向不发。",
      "若 shouldSend=true，message 必须是最终要发送的群消息，保持自然、简短、像群友即时发言。",
      "若 shouldSend=false，message 传空字符串。",
      "如果要 @ 某个群成员，使用 `{@昵称(qq)}` 格式；不要写成普通 `@昵称`。",
      "不要解释，不要复述思考过程，只通过工具参数给出最终裁决结果。",
      "</system_reminder>",
    ].join("\n"),
  );
}

export function createWebSearchReminderMessage(question: string): UserMessage {
  return createUserMessage(
    [
      "<system_reminder>",
      "你正在继承主 agent 当前上下文，临时执行一次网页检索子任务。",
      "这次不是群聊发言决策，也不是直接回复群消息；本轮唯一目标是为主 agent 搜集信息，并给回一段可复用的中文摘要。",
      "你应该基于当前上下文理解这个问题在指什么，再决定搜索策略，而不是把问题孤立地当成一句无上下文文本。",
      `当前要检索的问题：${question.trim()}`,
      "你可以按需把问题拆成多个关键词或子问题，并多次调用 search_web_raw。",
      "如果信息已经足够，调用 finalize_web_search 输出最终摘要；摘要必须基于检索结果，且在证据不足、结果冲突或时间不明确时明确保留不确定性。",
      "不要直接输出自由文本回答，不要复述思考过程，只通过工具调用推进本轮任务。",
      "</system_reminder>",
    ].join("\n"),
  );
}

export function createMessagesFromEvent(event: Event): UserMessage[] {
  switch (event.type) {
    case "napcat_group_message":
      return [
        createUserMessage(
          ["<message>", renderGroupMessagePlainText(event), "</message>"].join("\n"),
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
    return input.rawMessage;
  }

  const rendered = segments.map(renderSegmentText).join("").trim();
  return rendered.length > 0 ? rendered : input.rawMessage;
}

function renderSegmentText(segment: NapcatReceiveMessageSegment): string {
  switch (segment.type) {
    case "text":
      return segment.data.text;
    case "at":
      return formatAtSegment(segment) ?? `@${segment.data.qq}`;
    case "image":
      return formatImageSegmentText(segment.data.summary);
    case "reply":
      return "[reply]";
    case "face":
      return "[face]";
    case "forward":
      return "[forward]";
    case "file":
      return "[file]";
    case "json":
      return "[json]";
    case "markdown":
      return "[markdown]";
    case "poke":
      return "[poke]";
    case "record":
      return "[record]";
    case "rps":
      return "[rps]";
    case "dice":
      return "[dice]";
    case "video":
      return "[video]";
    default:
      return "[segment]";
  }
}
