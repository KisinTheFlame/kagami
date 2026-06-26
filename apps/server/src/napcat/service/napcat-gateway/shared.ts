import { z } from "zod";
import { isRecord } from "../../../common/prisma-json.js";
import {
  type NapcatSendAtSegment,
  type NapcatSendMessageSegment,
  type NapcatSendTextSegment,
  NapcatReceiveMessageSegmentSchema,
  type NapcatReceiveAtSegment,
  type NapcatReceiveForwardSegment,
  type NapcatReceiveImageSegment,
  type NapcatReceiveMessageSegment,
  type NapcatReceiveReplySegment,
  type NapcatReceiveTextSegment,
} from "../../schema/napcat-segment.js";

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

      return "";
    })
    .join("");
}

/**
 * 合并转发段：只渲染成带 res_id 的占位符,不内联展开内容。Kagami 想看靠 QQ App 的
 * view_forward(forward_id) 工具按需拉取——大段聊天记录绝不直接进主上下文（KV 缓存优先）。
 */
export function formatForwardSegment(segment: NapcatReceiveForwardSegment): string {
  const id = toNullableString(segment.data.id);
  return id ? `[forward_id: ${id}]` : "[合并转发]";
}

export function parseOutgoingMessageSegments(message: string): NapcatSendMessageSegment[] {
  const mentionPattern = /\{@([^{}()\n]+)\((\d+|all)\)\}/g;
  const segments: Array<NapcatSendTextSegment | NapcatSendAtSegment> = [];
  let lastIndex = 0;

  for (const match of message.matchAll(mentionPattern)) {
    const fullMatch = match[0];
    const nickname = match[1];
    const qq = match[2];
    const index = match.index;
    if (index === undefined || nickname.trim().length === 0) {
      continue;
    }

    if (index > lastIndex) {
      segments.push(createOutgoingTextSegment(message.slice(lastIndex, index)));
    }

    segments.push({
      type: "at",
      data: {
        qq,
      },
    });
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
