import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { NapcatEventDao } from "../dao/napcat-event.dao.js";
import { AppLogger } from "../logger/logger.js";
import type {
  NapcatGatewayService,
  NapcatSendGroupMessageInput,
  NapcatSendGroupMessageResult,
} from "./napcat-gateway.service.js";
import { NapcatGatewayError } from "./napcat-gateway.service.js";

type NapcatGatewayOptions = {
  wsUrl: string;
  reconnectMs: number;
  requestTimeoutMs: number;
  napcatEventDao?: NapcatEventDao;
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
  resolve: (result: { messageId: number }) => void;
  reject: (error: Error) => void;
};

const logger = new AppLogger({ source: "service.napcat-gateway" });
const WS_OPEN_READY_STATE = 1;

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
    group_id: z.union([z.string(), z.number()]).optional(),
    raw_message: z.string().optional(),
    time: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export class DefaultNapcatGatewayService implements NapcatGatewayService {
  private readonly wsUrl: string;
  private readonly reconnectMs: number;
  private readonly requestTimeoutMs: number;
  private readonly napcatEventDao: NapcatEventDao | null;
  private readonly createWebSocket: (url: string) => WebSocketLike;
  private readonly pendingRequests = new Map<string, PendingRequest>();

  private started = false;
  private socket: WebSocketLike | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  public constructor({
    wsUrl,
    reconnectMs,
    requestTimeoutMs,
    napcatEventDao,
    createWebSocket,
  }: NapcatGatewayOptions) {
    this.wsUrl = wsUrl;
    this.reconnectMs = reconnectMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.napcatEventDao = napcatEventDao ?? null;
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
      new NapcatGatewayError({
        code: "UPSTREAM_ERROR",
        message: "NapCat 网关已停止",
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
    const activeSocket = this.socket;
    if (!activeSocket || activeSocket.readyState !== WS_OPEN_READY_STATE) {
      throw new NapcatGatewayError({
        code: "NOT_CONNECTED",
        message: "NapCat WebSocket 未连接",
      });
    }

    const echo = randomUUID();
    const payload = {
      action: "send_group_msg",
      params: {
        group_id: groupId,
        message,
      },
      echo,
    };

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(echo);
        reject(
          new NapcatGatewayError({
            code: "REQUEST_TIMEOUT",
            message: "NapCat 请求超时",
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
          new NapcatGatewayError({
            code: "UPSTREAM_ERROR",
            message: "NapCat 请求发送失败",
            cause: error,
          }),
        );
      }
    });
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

    this.handlePostTypeEvent(postTypeEvent.data);
  }

  private handlePostTypeEvent(eventPayload: z.infer<typeof PostTypeEventSchema>): void {
    const userId = toNullableId(eventPayload.user_id);
    const groupId = toNullableId(eventPayload.group_id);
    const eventTime = toEventTime(eventPayload.time);

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

    if (!this.napcatEventDao) {
      return;
    }

    const payload = eventPayload as unknown as Record<string, unknown>;

    void this.napcatEventDao
      .insert({
        postType: eventPayload.post_type,
        messageType: toNullableString(eventPayload.message_type),
        subType: toNullableString(eventPayload.sub_type),
        userId,
        groupId,
        rawMessage: toNullableString(eventPayload.raw_message),
        eventTime,
        payload,
      })
      .catch(error => {
        logger.errorWithCause("Failed to persist NapCat event", error, {
          event: "napcat.gateway.event_persist_failed",
          postType: eventPayload.post_type,
          messageType: eventPayload.message_type,
        });
      });
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
        new NapcatGatewayError({
          code: "UPSTREAM_ERROR",
          message: response.wording ?? response.message ?? `NapCat 返回错误: ${response.retcode}`,
        }),
      );
      return;
    }

    const messageIdResult = z.number().int().positive().safeParse(response.data?.message_id);
    if (!messageIdResult.success) {
      pendingRequest.reject(
        new NapcatGatewayError({
          code: "UPSTREAM_ERROR",
          message: "NapCat 返回结果缺少 message_id",
        }),
      );
      return;
    }

    pendingRequest.resolve({
      messageId: messageIdResult.data,
    });
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
      new NapcatGatewayError({
        code: "UPSTREAM_ERROR",
        message: "NapCat websocket 已断开",
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
