import { z } from "zod";
import {
  NapcatReceiveMessageSegmentSchema,
  type NapcatReceiveAtSegment,
  type NapcatReceiveImageSegment,
  type NapcatReceiveMessageSegment,
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
  data: z.record(z.string(), z.unknown()).nullable().optional(),
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function isTextOrAtSegment(
  segment: NapcatReceiveMessageSegment,
): segment is NapcatReceiveTextOrAtSegment {
  return segment.type === "text" || segment.type === "at";
}

export function canRenderTextOrAtSegment(segment: NapcatReceiveTextOrAtSegment): boolean {
  if (segment.type === "text") {
    return true;
  }

  return formatAtSegment(segment) !== null;
}

export function formatImageSegmentText(text: string): string {
  return text.trim().length > 0 ? `[图片: ${text.trim()}]` : "[图片]";
}

export function replaceImageSegmentsInRawMessage(
  rawMessage: string,
  imageSegments: Array<{
    segment: NapcatReceiveImageSegment;
    renderedText: string;
  }>,
): string {
  let nextMessage = rawMessage;

  for (const { segment, renderedText } of imageSegments) {
    const urlPattern = new RegExp(
      `\\[CQ:image,file=[^\\]]*url=${escapeRegExp(segment.data.url)}[^\\]]*\\]`,
    );

    if (urlPattern.test(nextMessage)) {
      nextMessage = nextMessage.replace(urlPattern, renderedText);
      continue;
    }

    const filePattern = new RegExp(
      `\\[CQ:image,file=${escapeRegExp(segment.data.file)}(?:,[^\\]]*)?\\]`,
    );
    if (filePattern.test(nextMessage)) {
      nextMessage = nextMessage.replace(filePattern, renderedText);
      continue;
    }
  }

  return nextMessage;
}

export function replaceAtSegmentsInRawMessage(
  rawMessage: string,
  messageSegments: NapcatReceiveMessageSegment[],
): string {
  let nextMessage = rawMessage;

  for (const segment of messageSegments) {
    if (segment.type !== "at") {
      continue;
    }

    const formattedAt = formatAtSegment(segment);
    if (!formattedAt) {
      continue;
    }

    const cqAtPattern = new RegExp(`\\[CQ:at,qq=${escapeRegExp(segment.data.qq)}(?:,[^\\]]*)?\\]`);

    if (cqAtPattern.test(nextMessage)) {
      nextMessage = nextMessage.replace(cqAtPattern, formattedAt);
      continue;
    }

    const atName = toNullableString(segment.data.name);
    if (!atName) {
      continue;
    }

    const plainAtPattern = new RegExp(`@${escapeRegExp(atName)}`);
    nextMessage = nextMessage.replace(plainAtPattern, formattedAt);
  }

  return nextMessage;
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

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
