import { randomUUID } from "node:crypto";
import { z } from "zod";
import { formatGroupMessagePlainText } from "../agent/event.js";
import type { NapcatEventDao } from "../dao/napcat-event.dao.js";
import type { NapcatGroupMessageChunkDao } from "../dao/napcat-group-message-chunk.dao.js";
import type { NapcatGroupMessageDao } from "../dao/napcat-group-message.dao.js";
import { BizError } from "../errors/biz-error.js";
import { AppLogger } from "../logger/logger.js";
import type { GroupMessageChunkIndexer } from "../rag/indexer.service.js";
import {
  NapcatReceiveMessageSegmentSchema,
  type NapcatReceiveAtSegment,
  type NapcatReceiveMessageSegment,
  type NapcatReceiveTextSegment,
} from "../schema/napcat-segment.js";
import type {
  NapcatGroupMessageEvent,
  NapcatGatewayService,
  NapcatSendGroupMessageInput,
  NapcatSendGroupMessageResult,
} from "./napcat-gateway.service.js";

type NapcatGatewayOptions = {
  wsUrl: string;
  reconnectMs: number;
  requestTimeoutMs: number;
  listenGroupId: string;
  onGroupMessage?: (event: NapcatGroupMessageEvent) => void | Promise<void>;
  napcatEventDao?: NapcatEventDao;
  napcatGroupMessageDao?: NapcatGroupMessageDao;
  napcatGroupMessageChunkDao?: NapcatGroupMessageChunkDao;
  groupMessageChunkIndexer?: GroupMessageChunkIndexer;
  createWebSocket?: (url: string) => WebSocketLike;
};

type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event?: unknown) => void): void;
};

type PendingRequest = {
  timeout: NodeJS.Timeout;
  resolve: (result: Record<string, unknown> | null) => void;
  reject: (error: Error) => void;
};

type GroupMemberDisplayNameCacheEntry = {
  displayName: string;
  expiresAt: number;
};

const logger = new AppLogger({ source: "service.napcat-gateway" });
const WS_OPEN_READY_STATE = 1;
const BLOCKED_NAPCAT_EVENT_POST_TYPES = new Set<string>(["meta_event"]);
const GROUP_MEMBER_DISPLAY_NAME_CACHE_TTL_MS = 10 * 60 * 1000;
const MessageSegmentsSchema = z.array(NapcatReceiveMessageSegmentSchema);
type NapcatReceiveTextOrAtSegment = NapcatReceiveTextSegment | NapcatReceiveAtSegment;

const ActionResponseSchema = z.object({
  status: z.string(),
  retcode: z.number(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  message: z.string().optional(),
  wording: z.string().optional(),
  echo: z.string(),
});

const PostTypeEventSchema = z
  .object({
    post_type: z.string().min(1),
    message_type: z.string().optional(),
    sub_type: z.string().optional(),
    user_id: z.union([z.string(), z.number()]).optional(),
    self_id: z.union([z.string(), z.number()]).optional(),
    group_id: z.union([z.string(), z.number()]).optional(),
    raw_message: z.string().optional(),
    time: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export class DefaultNapcatGatewayService implements NapcatGatewayService {
  private readonly wsUrl: string;
  private readonly reconnectMs: number;
  private readonly requestTimeoutMs: number;
  private readonly listenGroupId: string;
  private readonly onGroupMessage:
    | ((event: NapcatGroupMessageEvent) => void | Promise<void>)
    | null;
  private readonly napcatEventDao: NapcatEventDao | null;
  private readonly napcatGroupMessageDao: NapcatGroupMessageDao | null;
  private readonly napcatGroupMessageChunkDao: NapcatGroupMessageChunkDao | null;
  private readonly groupMessageChunkIndexer: GroupMessageChunkIndexer | null;
  private readonly createWebSocket: (url: string) => WebSocketLike;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly groupMemberDisplayNameCache = new Map<
    string,
    GroupMemberDisplayNameCacheEntry
  >();

  private started = false;
  private socket: WebSocketLike | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  public constructor({
    wsUrl,
    reconnectMs,
    requestTimeoutMs,
    listenGroupId,
    onGroupMessage,
    napcatEventDao,
    napcatGroupMessageDao,
    napcatGroupMessageChunkDao,
    groupMessageChunkIndexer,
    createWebSocket,
  }: NapcatGatewayOptions) {
    this.wsUrl = wsUrl;
    this.reconnectMs = reconnectMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.listenGroupId = listenGroupId;
    this.onGroupMessage = onGroupMessage ?? null;
    this.napcatEventDao = napcatEventDao ?? null;
    this.napcatGroupMessageDao = napcatGroupMessageDao ?? null;
    this.napcatGroupMessageChunkDao = napcatGroupMessageChunkDao ?? null;
    this.groupMessageChunkIndexer = groupMessageChunkIndexer ?? null;
    this.createWebSocket = createWebSocket ?? (url => new WebSocket(url));
  }

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.connect();
  }

  public async stop(): Promise<void> {
    this.started = false;
    this.clearReconnectTimer();
    this.rejectAllPending(
      new BizError({
        message: "NapCat 网关已停止",
        meta: {
          reason: "GATEWAY_STOPPED",
        },
      }),
    );

    const activeSocket = this.socket;
    this.socket = null;
    if (activeSocket) {
      activeSocket.close(1000, "Gateway stopped");
    }
  }

  public async sendGroupMessage({
    groupId,
    message,
  }: NapcatSendGroupMessageInput): Promise<NapcatSendGroupMessageResult> {
    const data = await this.sendActionRequest({
      action: "send_group_msg",
      params: {
        group_id: groupId,
        message: [
          {
            type: "text",
            data: {
              text: message,
            },
          },
        ],
      },
    });

    const messageIdResult = z.number().int().positive().safeParse(data?.message_id);
    if (!messageIdResult.success) {
      throw new BizError({
        message: "NapCat 返回结果缺少 message_id",
        meta: {
          reason: "MISSING_MESSAGE_ID",
        },
      });
    }

    return {
      messageId: messageIdResult.data,
    };
  }

  private connect(): void {
    if (!this.started) {
      return;
    }

    try {
      const socket = this.createWebSocket(this.wsUrl);
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.handleSocketOpen(socket);
      });
      socket.addEventListener("message", event => {
        const data = (event as { data?: unknown } | undefined)?.data;
        this.handleSocketMessage(data);
      });
      socket.addEventListener("close", event => {
        this.handleSocketClose(socket, event as { code?: number; reason?: string });
      });
      socket.addEventListener("error", event => {
        this.handleSocketError(
          event as {
            error?: unknown;
            message?: string;
            type?: string;
          },
        );
      });
    } catch (error) {
      logger.errorWithCause("Failed to connect NapCat websocket", error, {
        event: "napcat.gateway.connect_failed",
        wsUrl: this.wsUrl,
      });
      this.scheduleReconnect();
    }
  }

  private handleSocketOpen(socket: WebSocketLike): void {
    if (this.socket !== socket) {
      return;
    }

    this.clearReconnectTimer();
    logger.info("NapCat websocket connected", {
      event: "napcat.gateway.connected",
      wsUrl: this.wsUrl,
    });
  }

  private handleSocketMessage(rawData: unknown): void {
    if (typeof rawData !== "string") {
      logger.warn("NapCat websocket message is not a string", {
        event: "napcat.gateway.message_non_string",
      });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawData);
    } catch (error) {
      logger.errorWithCause("Failed to parse NapCat websocket message", error, {
        event: "napcat.gateway.message_parse_failed",
      });
      return;
    }

    const actionResponse = ActionResponseSchema.safeParse(payload);
    if (actionResponse.success) {
      this.resolveActionResponse(actionResponse.data);
      return;
    }

    const postTypeEvent = PostTypeEventSchema.safeParse(payload);
    if (!postTypeEvent.success) {
      return;
    }

    void this.handlePostTypeEvent(postTypeEvent.data).catch(error => {
      logger.errorWithCause("Failed to handle NapCat post type event", error, {
        event: "napcat.gateway.post_type_event_handle_failed",
        postType: postTypeEvent.data.post_type,
        messageType: postTypeEvent.data.message_type,
        groupId: toNullableId(postTypeEvent.data.group_id),
        userId: toNullableId(postTypeEvent.data.user_id),
      });
    });
  }

  private async handlePostTypeEvent(
    eventPayload: z.infer<typeof PostTypeEventSchema>,
  ): Promise<void> {
    const userId = toNullableId(eventPayload.user_id);
    const selfId = toNullableId(eventPayload.self_id);
    const groupId = toNullableId(eventPayload.group_id);
    const nickname = extractSenderNickname(eventPayload as unknown as Record<string, unknown>);
    const eventTime = toEventTime(eventPayload.time);
    const payload = eventPayload as unknown as Record<string, unknown>;
    const rawMessage = await this.extractFormattedRawMessage({ payload, groupId });

    if (eventPayload.post_type === "message" && eventPayload.message_type === "private") {
      logger.info("Received NapCat private message event", {
        event: "napcat.gateway.private_message_received",
        userId,
        messageId: toNullableNumber(eventPayload.message_id),
        rawMessage: eventPayload.raw_message,
        time: eventPayload.time,
        subType: eventPayload.sub_type,
      });
    }

    if (
      this.shouldDispatchGroupMessageEvent({
        eventPayload,
        groupId,
        userId,
        nickname,
        selfId,
        rawMessage,
      })
    ) {
      const groupMessageEvent = {
        groupId: groupId!,
        userId: userId!,
        nickname: nickname!,
        rawMessage: rawMessage!,
        messageId: toNullablePositiveInt(eventPayload.message_id),
        time: toNullablePositiveInt(eventPayload.time),
        payload,
      };

      this.emitGroupMessageEvent(groupMessageEvent);
      this.persistGroupMessage(groupMessageEvent, eventTime);
    }

    if (!this.napcatEventDao) {
      return;
    }

    if (BLOCKED_NAPCAT_EVENT_POST_TYPES.has(eventPayload.post_type)) {
      return;
    }

    void this.napcatEventDao
      .insert({
        postType: eventPayload.post_type,
        messageType: toNullableString(eventPayload.message_type),
        subType: toNullableString(eventPayload.sub_type),
        userId,
        groupId,
        rawMessage,
        eventTime,
        payload,
      })
      .catch(error => {
        logger.errorWithCause("Failed to persist NapCat event", error, {
          event: "napcat.gateway.event_persist_failed",
          postType: eventPayload.post_type,
          messageType: eventPayload.message_type,
          nickname,
        });
      });
  }

  private persistGroupMessage(event: NapcatGroupMessageEvent, eventTime: Date | null): void {
    if (!this.napcatGroupMessageDao) {
      return;
    }

    void this.napcatGroupMessageDao
      .insert({
        groupId: event.groupId,
        userId: event.userId,
        nickname: extractSenderNickname(event.payload),
        messageId: event.messageId,
        message: toStoredMessageSegments(event.payload.message),
        eventTime,
        payload: event.payload,
      })
      .then(async sourceMessageId => {
        if (!this.napcatGroupMessageChunkDao) {
          return;
        }

        const chunkId = await this.napcatGroupMessageChunkDao.insert({
          sourceMessageId,
          groupId: event.groupId,
          chunkIndex: 0,
          content: formatGroupMessagePlainText({
            nickname: event.nickname,
            userId: event.userId,
            rawMessage: event.rawMessage,
          }),
          status: "pending",
          embeddingModel: null,
          embeddingDim: null,
          errorMessage: null,
        });
        this.groupMessageChunkIndexer?.enqueue(chunkId);
      })
      .catch(error => {
        logger.errorWithCause("Failed to persist NapCat group message", error, {
          event: "napcat.gateway.group_message_persist_failed",
          groupId: event.groupId,
          userId: event.userId,
          messageId: event.messageId,
        });
      });
  }

  private shouldDispatchGroupMessageEvent({
    eventPayload,
    groupId,
    userId,
    nickname,
    selfId,
    rawMessage,
  }: {
    eventPayload: z.infer<typeof PostTypeEventSchema>;
    groupId: string | null;
    userId: string | null;
    nickname: string | null;
    selfId: string | null;
    rawMessage: string | null;
  }): boolean {
    if (eventPayload.post_type !== "message" || eventPayload.message_type !== "group") {
      return false;
    }

    if (!groupId || groupId !== this.listenGroupId) {
      return false;
    }

    if (!rawMessage) {
      return false;
    }

    if (!userId || !nickname) {
      return false;
    }

    if (selfId !== null && userId !== null && selfId === userId) {
      return false;
    }

    return true;
  }

  private emitGroupMessageEvent(event: NapcatGroupMessageEvent): void {
    if (!this.onGroupMessage) {
      return;
    }

    try {
      const result = this.onGroupMessage(event);
      void Promise.resolve(result).catch(error => {
        logger.errorWithCause("Failed to publish group message event", error, {
          event: "napcat.gateway.group_message_publish_failed",
          groupId: event.groupId,
          userId: event.userId,
          messageId: event.messageId,
        });
      });
    } catch (error) {
      logger.errorWithCause("Failed to publish group message event", error, {
        event: "napcat.gateway.group_message_publish_failed",
        groupId: event.groupId,
        userId: event.userId,
        messageId: event.messageId,
      });
    }
  }

  private resolveActionResponse(response: z.infer<typeof ActionResponseSchema>): void {
    const pendingRequest = this.pendingRequests.get(response.echo);
    if (!pendingRequest) {
      return;
    }

    clearTimeout(pendingRequest.timeout);
    this.pendingRequests.delete(response.echo);

    if (response.status !== "ok" || response.retcode !== 0) {
      pendingRequest.reject(
        new BizError({
          message: response.wording ?? response.message ?? `NapCat 返回错误: ${response.retcode}`,
          meta: {
            reason: "ACTION_FAILED",
            retcode: response.retcode,
          },
        }),
      );
      return;
    }

    pendingRequest.resolve(response.data ?? null);
  }

  private handleSocketClose(
    socket: WebSocketLike,
    event: {
      code?: number;
      reason?: string;
    },
  ): void {
    if (this.socket === socket) {
      this.socket = null;
    }

    this.rejectAllPending(
      new BizError({
        message: "NapCat websocket 已断开",
        meta: {
          reason: "SOCKET_CLOSED",
          code: event.code,
          socketReason: event.reason,
        },
      }),
    );

    if (!this.started) {
      return;
    }

    logger.warn("NapCat websocket disconnected", {
      event: "napcat.gateway.disconnected",
      code: event.code,
      reason: event.reason,
    });
    this.scheduleReconnect();
  }

  private handleSocketError(event: { error?: unknown; message?: string; type?: string }): void {
    logger.error("NapCat websocket emitted error event", {
      event: "napcat.gateway.websocket_error",
      type: event.type,
      message: event.message,
      error: event.error instanceof Error ? event.error.message : undefined,
    });
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectMs);

    logger.info("NapCat websocket reconnect scheduled", {
      event: "napcat.gateway.reconnect_scheduled",
      delayMs: this.reconnectMs,
    });
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private rejectAllPending(error: Error): void {
    for (const [echo, pendingRequest] of this.pendingRequests.entries()) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error);
      this.pendingRequests.delete(echo);
    }
  }

  private async sendActionRequest({
    action,
    params,
  }: {
    action: string;
    params: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null> {
    const activeSocket = this.socket;
    if (!activeSocket || activeSocket.readyState !== WS_OPEN_READY_STATE) {
      throw new BizError({
        message: "NapCat WebSocket 未连接",
        meta: {
          reason: "NOT_CONNECTED",
        },
      });
    }

    const echo = randomUUID();
    const payload = {
      action,
      params,
      echo,
    };

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(echo);
        reject(
          new BizError({
            message: "NapCat 请求超时",
            meta: {
              reason: "REQUEST_TIMEOUT",
              action,
            },
          }),
        );
      }, this.requestTimeoutMs);

      this.pendingRequests.set(echo, { timeout, resolve, reject });

      try {
        activeSocket.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(echo);
        reject(
          new BizError({
            message: "NapCat 请求发送失败",
            meta: {
              reason: "SEND_FAILED",
              action,
            },
            cause: error,
          }),
        );
      }
    });
  }

  private async extractFormattedRawMessage({
    payload,
    groupId,
  }: {
    payload: Record<string, unknown>;
    groupId: string | null;
  }): Promise<string | null> {
    const rawMessage = toNullableString(payload.raw_message);
    const messageSegments = parseMessageSegments(payload.message);

    if (!messageSegments || messageSegments.length === 0) {
      return rawMessage;
    }

    const hydratedSegments = await this.hydrateAtSegmentNames({
      groupId,
      messageSegments,
    });

    if (
      hydratedSegments.every(isTextOrAtSegment) &&
      hydratedSegments.every(canRenderTextOrAtSegment)
    ) {
      return hydratedSegments
        .map(segment => {
          if (segment.type === "text") {
            return segment.data.text;
          }

          return formatAtSegment(segment) ?? "";
        })
        .join("");
    }

    if (!rawMessage) {
      return null;
    }

    return replaceAtSegmentsInRawMessage(rawMessage, hydratedSegments);
  }

  private async hydrateAtSegmentNames({
    groupId,
    messageSegments,
  }: {
    groupId: string | null;
    messageSegments: NapcatReceiveMessageSegment[];
  }): Promise<NapcatReceiveMessageSegment[]> {
    return await Promise.all(
      messageSegments.map(async segment => {
        if (segment.type !== "at") {
          return segment;
        }

        const currentName = toNullableString(segment.data.name);
        if (currentName) {
          return segment;
        }

        const displayName = await this.resolveAtDisplayName({
          groupId,
          qq: segment.data.qq,
        });
        if (!displayName) {
          return segment;
        }

        return withAtSegmentName(segment, displayName);
      }),
    );
  }

  private async resolveAtDisplayName({
    groupId,
    qq,
  }: {
    groupId: string | null;
    qq: string | "all";
  }): Promise<string | null> {
    if (qq === "all") {
      return "全体成员";
    }

    if (!groupId) {
      return null;
    }

    return await this.queryGroupMemberDisplayName({
      groupId,
      userId: qq,
    });
  }

  private async queryGroupMemberDisplayName({
    groupId,
    userId,
  }: {
    groupId: string;
    userId: string;
  }): Promise<string | null> {
    const cacheKey = `${groupId}:${userId}`;
    const now = Date.now();
    const cachedEntry = this.groupMemberDisplayNameCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > now) {
      return cachedEntry.displayName;
    }

    if (cachedEntry) {
      this.groupMemberDisplayNameCache.delete(cacheKey);
    }

    try {
      const data = await this.sendActionRequest({
        action: "get_group_member_info",
        params: {
          group_id: groupId,
          user_id: userId,
          no_cache: false,
        },
      });
      const displayName = extractDisplayNameFromGroupMemberInfo(data);

      if (displayName) {
        this.groupMemberDisplayNameCache.set(cacheKey, {
          displayName,
          expiresAt: now + GROUP_MEMBER_DISPLAY_NAME_CACHE_TTL_MS,
        });
      }

      return displayName;
    } catch (error) {
      logger.warn("Failed to query NapCat group member info", {
        event: "napcat.gateway.group_member_info_query_failed",
        groupId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

function toNullableId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function extractSenderNickname(payload: Record<string, unknown>): string | null {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.length > 0 ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function toNullablePositiveInt(value: unknown): number | null {
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

function toEventTime(value: unknown): Date | null {
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

function parseMessageSegments(value: unknown): NapcatReceiveMessageSegment[] | null {
  const parsed = MessageSegmentsSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

function toStoredMessageSegments(value: unknown): NapcatReceiveMessageSegment[] {
  return parseMessageSegments(value) ?? [];
}

function isTextOrAtSegment(
  segment: NapcatReceiveMessageSegment,
): segment is NapcatReceiveTextOrAtSegment {
  return segment.type === "text" || segment.type === "at";
}

function canRenderTextOrAtSegment(segment: NapcatReceiveTextOrAtSegment): boolean {
  if (segment.type === "text") {
    return true;
  }

  return formatAtSegment(segment) !== null;
}

function replaceAtSegmentsInRawMessage(
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

function formatAtSegment(segment: NapcatReceiveAtSegment): string | null {
  const qq = segment.data.qq;
  const name = toNullableString(segment.data.name) ?? (qq === "all" ? "全体成员" : null);
  if (!name) {
    return null;
  }

  return `{@${name}(${qq})}`;
}

function withAtSegmentName(segment: NapcatReceiveAtSegment, name: string): NapcatReceiveAtSegment {
  return {
    ...segment,
    data: {
      ...segment.data,
      name,
    },
  };
}

function extractDisplayNameFromGroupMemberInfo(
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
