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
const REPLY_THOUGHT_TAG = "reply_thought";

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

export function createReplyThoughtMessage(thought: string): UserMessage {
  return createUserMessage(
    [`<${REPLY_THOUGHT_TAG}>`, thought.trim(), `</${REPLY_THOUGHT_TAG}>`].join("\n"),
  );
}

export function createReplyThoughtReminderMessage(): UserMessage {
  return createUserMessage(
    [
      "<system_reminder>",
      "你正在为是否发送下一条群消息做内部思考。请不要直接写最终发送文案，也不要解释你在调用工具。",
      "默认倾向是不发送。只有当现在插一句会明显比沉默更自然时，才考虑发送。",
      "只有在这些情况明显成立时，才值得回复：被直接 @ 或点名；最近 1 到 3 条里有非常顺手的梗；存在一句话就能自然接上的明确切口；不说反而显得奇怪。",
      "如果更像主动找话题、需要解释超过两句、只是重复别人刚说过的话、或只是轻微改写现成观点，就应倾向不发。",
      "请在 thought 中自然写清楚：这次是否值得回复、最值得接的目标或话题点、可以回复的角度、简短草稿提示。",
      "如果更自然的选择是不回复，也要在 thought 中明确写出来，而且理由要具体。",
      "</system_reminder>",
    ].join("\n"),
  );
}

export function createReplyReviewReminderMessage(): UserMessage {
  return createUserMessage(
    [
      "<system_reminder>",
      "你正在审核上面的 <reply_thought>。",
      "默认应把 approve 设为 false。只有在你能明确判断“现在发出去明显比不发更自然”时，才允许 approve=true。",
      "只审核回复策略是否自然、是否有必要、是否像群友顺口接一句；不要直接编写最终发送文案。",
      "出现以下任一情况就必须拒绝：没有明确目标；只是重复或轻微改写别人刚说的话；像解释、总结、教学、端水；需要较长铺垫才能成立；沉默明显更自然。",
      "只有当回复目标明确、切口自然、内容短促顺口、且发出去能明显改善当前聊天自然度时，才可以 approve=true。",
      "如果 approve=true，就在 thought 中写简短审核意见或写作约束；如果 approve=false，就在 thought 中简短写明为什么不该发。",
      "</system_reminder>",
    ].join("\n"),
  );
}

export function createReplyWriterReminderMessage(reviewThought: string): UserMessage {
  return createUserMessage(
    [
      "<system_reminder>",
      "你将根据上面的 <reply_thought> 与下面的审核意见，写出最终要发送的群消息。",
      "只输出最终消息内容对应的 tool 参数，不要解释，不要复述思考过程。",
      "保持自然、简短、像群友即时发言。",
      "如果要 @ 某个群成员，使用 `{@昵称(qq)}` 格式；不要写成普通 `@昵称`。",
      `<review_thought>\n${reviewThought.trim()}\n</review_thought>`,
      "</system_reminder>",
    ].join("\n"),
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
