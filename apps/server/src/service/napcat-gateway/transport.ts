import { randomUUID } from "node:crypto";
import { BizError } from "../../errors/biz-error.js";
import { AppLogger } from "../../logger/logger.js";
import {
  type NapcatGatewayActionResponse,
  type WebSocketLike,
  WS_OPEN_READY_STATE,
} from "./shared.js";

type PendingRequest = {
  timeout: NodeJS.Timeout;
  resolve: (result: Record<string, unknown> | null) => void;
  reject: (error: Error) => void;
};

type NapcatGatewayTransportOptions = {
  wsUrl: string;
  reconnectMs: number;
  requestTimeoutMs: number;
  onMessage: (rawData: unknown) => void;
  createWebSocket?: (url: string) => WebSocketLike;
};

const logger = new AppLogger({ source: "service.napcat-gateway" });

export class NapcatGatewayTransport {
  private readonly wsUrl: string;
  private readonly reconnectMs: number;
  private readonly requestTimeoutMs: number;
  private readonly onMessage: (rawData: unknown) => void;
  private readonly createWebSocket: (url: string) => WebSocketLike;
  private readonly pendingRequests = new Map<string, PendingRequest>();

  private started = false;
  private socket: WebSocketLike | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  public constructor({
    wsUrl,
    reconnectMs,
    requestTimeoutMs,
    onMessage,
    createWebSocket,
  }: NapcatGatewayTransportOptions) {
    this.wsUrl = wsUrl;
    this.reconnectMs = reconnectMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.onMessage = onMessage;
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

  public async request(
    action: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
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

  public resolveActionResponse(response: NapcatGatewayActionResponse): void {
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
        this.onMessage(data);
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
}
