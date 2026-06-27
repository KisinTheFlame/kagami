import { z } from "zod";
import { isRecord } from "../../../common/prisma-json.js";
import {
  type NapcatSendAtSegment,
  type NapcatSendFaceSegment,
  type NapcatSendMessageSegment,
  type NapcatSendReplySegment,
  type NapcatSendTextSegment,
  NapcatReceiveMessageSegmentSchema,
  type NapcatReceiveAtSegment,
  type NapcatReceiveFaceSegment,
  type NapcatReceiveForwardSegment,
  type NapcatReceiveImageSegment,
  type NapcatReceiveMessageSegment,
  type NapcatReceiveReplySegment,
  type NapcatReceiveTextSegment,
} from "../../domain/napcat-segment.js";
import { QQ_FACE_NAMES, normalizeFaceText, resolveFaceId } from "./qq-face-names.js";

export type { NapcatReceiveAtSegment, NapcatReceiveMessageSegment, NapcatReceiveTextSegment };

export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event?: unknown) => void): void;
};

export type NapcatGatewayNormalizedPostTypeEvent = {
  postType: string;
  messageType: string | null;
  subType: string | null;
  userId: string | null;
  selfId: string | null;
  groupId: string | null;
  nickname: string | null;
  rawMessage: string | null;
  messageSegments: NapcatReceiveMessageSegment[];
  messageId: number | null;
  time: number | null;
  eventTime: Date | null;
  payload: Record<string, unknown>;
};

export const WS_OPEN_READY_STATE = 1;
export const BLOCKED_NAPCAT_EVENT_POST_TYPES = new Set<string>(["meta_event"]);
export const GROUP_MEMBER_DISPLAY_NAME_CACHE_TTL_MS = 10 * 60 * 1000;

export const MessageSegmentsSchema = z.array(NapcatReceiveMessageSegmentSchema);
export type NapcatReceiveTextOrAtSegment = NapcatReceiveTextSegment | NapcatReceiveAtSegment;

export const ActionResponseSchema = z.object({
  status: z.string(),
  retcode: z.number(),
  data: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .nullable()
    .optional(),
  message: z.string().optional(),
  wording: z.string().optional(),
  echo: z.string(),
});

export const PostTypeEventSchema = z
  .object({
    post_type: z.string().min(1),
    message_type: z.string().optional(),
    sub_type: z.string().optional(),
    user_id: z.union([z.string(), z.number()]).optional(),
    self_id: z.union([z.string(), z.number()]).optional(),
    group_id: z.union([z.string(), z.number()]).optional(),
    message_id: z.union([z.number(), z.string()]).optional(),
    raw_message: z.string().optional(),
    time: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export type NapcatGatewayActionResponse = z.infer<typeof ActionResponseSchema>;
export type NapcatGatewayActionResponseData = NapcatGatewayActionResponse["data"];
export type NapcatGatewayPostTypeEventPayload = z.infer<typeof PostTypeEventSchema>;

export function toNullableId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

export function extractSenderNickname(payload: Record<string, unknown>): string | null {
  const sender = payload.sender;
  if (!isRecord(sender)) {
    return null;
  }

  const card = toNullableString(sender.card);
  if (card) {
    return card;
  }

  return toNullableString(sender.nickname);
}

export function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.length > 0 ? value : null;
}

export function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

export function toNullablePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }

  return null;
}

export function toEventTime(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(Math.trunc(value) * 1000);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return new Date(Math.trunc(parsed) * 1000);
    }
  }

  return null;
}

export function parseMessageSegments(value: unknown): NapcatReceiveMessageSegment[] | null {
  const parsed = MessageSegmentsSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function toStoredMessageSegments(value: unknown): NapcatReceiveMessageSegment[] {
  return parseMessageSegments(value) ?? [];
}

export function formatImageSegmentText(summary: string, resid?: string | null): string {
  const description = summary.trim();
  const head = description.length > 0 ? `图片: ${description}` : "图片";
  return resid ? `[${head}, resid: ${resid}]` : `[${head}]`;
}

export function renderSupportedMessageSegments(
  messageSegments: NapcatReceiveMessageSegment[],
  options?: {
    renderAtSegment?: (segment: NapcatReceiveAtSegment) => string;
    renderImageSegment?: (segment: NapcatReceiveImageSegment) => string;
  },
): string {
  return messageSegments
    .map(segment => {
      if (segment.type === "text") {
        return segment.data.text;
      }

      if (segment.type === "at") {
        return (
          options?.renderAtSegment?.(segment) ?? formatAtSegment(segment) ?? `@${segment.data.qq}`
        );
      }

      if (segment.type === "image") {
        return (
          options?.renderImageSegment?.(segment) ??
          formatImageSegmentText(segment.data.summary, segment.data.resid)
        );
      }

      if (segment.type === "reply") {
        return formatReplySegment(segment);
      }

      if (segment.type === "forward") {
        return formatForwardSegment(segment);
      }

      if (segment.type === "face") {
        return formatFaceSegment(segment);
      }

      return "";
    })
    .join("");
}

/**
 * 渲染合并转发占位符里 res_id 的前缀。res_id 是 19 位长数字，直接露出会被 LLM 当 JSON number
 * 传给 view_forward——既被 string schema 拦下，又因超出安全整数而丢精度。加个非数字前缀强制
 * 它在 JSON 里只能是字符串，精度无损；view_forward 收到后剥掉前缀。
 */
export const FORWARD_ID_DISPLAY_PREFIX = "fwd-";

/**
 * 合并转发段：只渲染成带 res_id 的占位符,不内联展开内容。Kagami 想看靠 QQ App 的
 * view_forward(forward_id) 工具按需拉取——大段聊天记录绝不直接进主上下文（KV 缓存优先）。
 */
export function formatForwardSegment(segment: NapcatReceiveForwardSegment): string {
  const id = toNullableString(segment.data.id);
  return id ? `[forward_id: ${FORWARD_ID_DISPLAY_PREFIX}${id}]` : "[合并转发]";
}

/**
 * QQ 内置小表情（face 段）。此前被渲染器丢成空字符串，小镜完全感知不到群友发的表情；
 * 现在渲染成 `[表情: 名字]`。名字优先取 NapCat 给的 `raw.faceText`（最权威），其次查兜底字典，
 * 都没有再退化成通用 `[表情]`。和 `[图片: 描述]` / `[合并转发]` 的方括号占位约定保持一致。
 */
export function formatFaceSegment(segment: NapcatReceiveFaceSegment): string {
  const name = resolveFaceName(segment);
  return name ? `[表情: ${name}]` : "[表情]";
}

function resolveFaceName(segment: NapcatReceiveFaceSegment): string | null {
  const faceText = toNullableString(segment.data.raw.faceText);
  if (faceText) {
    const normalized = normalizeFaceText(faceText);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return QQ_FACE_NAMES[segment.data.id] ?? null;
}

/**
 * 出站文本 → NapCat 消息段。识别两种内联标记并还原成对应段，其余按纯文本处理：
 *   - `{@昵称(qq)}` → at 段（@提及）
 *   - `[表情: 名字]` → face 段（QQ 内置表情），名字查不到时原样保留为文本，绝不静默丢弃
 *
 * 两种标记都与「接收侧」的渲染格式对称（见 {@link formatAtSegment} / {@link formatFaceSegment}）：
 * 小镜照着自己收到的样子写，就能把同样的 @ 和表情发出去。表情标记的冒号半角 / 全角都认——
 * 中文输出常打出全角 `：`，不放宽会让它漏成纯文本。
 */
export function parseOutgoingMessageSegments(message: string): NapcatSendMessageSegment[] {
  const tokenPattern = /\{@([^{}()\n]+)\((\d+|all)\)\}|\[表情[:：]\s*([^\]\n]+)\]/g;
  const segments: NapcatSendMessageSegment[] = [];
  let lastIndex = 0;

  for (const match of message.matchAll(tokenPattern)) {
    const index = match.index;
    if (index === undefined) {
      continue;
    }

    const [fullMatch, mentionNickname, mentionQq, faceName] = match;
    const replacement: NapcatSendAtSegment | NapcatSendFaceSegment | null = mentionQq
      ? createMentionSegment(mentionNickname, mentionQq)
      : createFaceSegment(faceName);

    // 标记无效（@昵称为空 / 表情名查不到）：不消费成段，保留原文当文本一起发出去。
    if (!replacement) {
      continue;
    }

    if (index > lastIndex) {
      segments.push(createOutgoingTextSegment(message.slice(lastIndex, index)));
    }
    segments.push(replacement);
    lastIndex = index + fullMatch.length;
  }

  if (lastIndex < message.length) {
    segments.push(createOutgoingTextSegment(message.slice(lastIndex)));
  }

  if (segments.length === 0) {
    return [createOutgoingTextSegment(message)];
  }

  return segments;
}

/**
 * 组装一条出站消息的 segment 数组：先按文本/@/表情标记解析正文，若指定了回复目标，再把一个
 * reply 段前置到最前面（OneBot 约定 reply 段在首位，整条消息即成为对该消息的引用回复）。
 */
export function buildOutgoingMessageSegments(
  message: string,
  replyToMessageId?: number,
): NapcatSendMessageSegment[] {
  const body = parseOutgoingMessageSegments(message);
  if (replyToMessageId === undefined) {
    return body;
  }
  return [createOutgoingReplySegment(replyToMessageId), ...body];
}

function createOutgoingReplySegment(messageId: number): NapcatSendReplySegment {
  return {
    type: "reply",
    data: {
      id: String(messageId),
    },
  };
}

function createMentionSegment(nickname: string, qq: string): NapcatSendAtSegment | null {
  if (nickname.trim().length === 0) {
    return null;
  }

  return {
    type: "at",
    data: {
      qq,
    },
  };
}

function createFaceSegment(name: string): NapcatSendFaceSegment | null {
  const id = resolveFaceId(name);
  return id ? { type: "face", data: { id } } : null;
}

export function formatAtSegment(segment: NapcatReceiveAtSegment): string | null {
  const qq = segment.data.qq;
  const name = toNullableString(segment.data.name) ?? (qq === "all" ? "全体成员" : null);
  if (!name) {
    return null;
  }

  return `{@${name}(${qq})}`;
}

export function withAtSegmentName(
  segment: NapcatReceiveAtSegment,
  name: string,
): NapcatReceiveAtSegment {
  return {
    ...segment,
    data: {
      ...segment.data,
      name,
    },
  };
}

export function extractDisplayNameFromGroupMemberInfo(
  data: Record<string, unknown> | null,
): string | null {
  if (!data) {
    return null;
  }

  const card = toNullableString(data.card);
  if (card) {
    return card;
  }

  return toNullableString(data.nickname);
}

export function formatReplySegment(segment: NapcatReceiveReplySegment): string {
  const nickname = toNullableString(segment.data.senderNickname);
  const userId = toNullableString(segment.data.senderUserId);
  const preview = toNullableString(segment.data.messagePreview);

  if (nickname && userId && preview) {
    return `<reference>\n回复 ${nickname} (${userId}):\n${preview}\n</reference>\n`;
  }

  return "<reference />\n";
}

export function withReplyHydration(
  segment: NapcatReceiveReplySegment,
  hydration: {
    senderNickname: string;
    senderUserId: string;
    messagePreview: string;
  },
): NapcatReceiveReplySegment {
  return {
    ...segment,
    data: {
      ...segment.data,
      senderNickname: hydration.senderNickname,
      senderUserId: hydration.senderUserId,
      messagePreview: hydration.messagePreview,
    },
  };
}

function createOutgoingTextSegment(text: string): NapcatSendTextSegment {
  return {
    type: "text",
    data: {
      text,
    },
  };
}
