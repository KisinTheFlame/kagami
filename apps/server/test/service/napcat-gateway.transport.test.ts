import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NapcatGatewayTransport } from "../../src/service/napcat-gateway/transport.js";
import { FakeWebSocket, initTestLogger } from "./napcat-gateway.test-helper.js";

describe("NapcatGatewayTransport", () => {
  beforeEach(() => {
    initTestLogger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve request when NapCat returns success response", async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new NapcatGatewayTransport({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      onMessage: vi.fn(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    await transport.start();
    const socket = sockets[0];
    socket.emitOpen();

    const requestPromise = transport.request("send_group_msg", {
      group_id: "987654",
      message: "hello",
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as { echo: string };

    transport.resolveActionResponse({
      status: "ok",
      retcode: 0,
      data: {
        message_id: 9528,
      },
      message: "",
      echo: sentPayload.echo,
    });

    await expect(requestPromise).resolves.toEqual({ message_id: 9528 });
    await transport.stop();
  });

  it("should reject when NapCat returns retcode error", async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new NapcatGatewayTransport({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      onMessage: vi.fn(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    await transport.start();
    const socket = sockets[0];
    socket.emitOpen();

    const requestPromise = transport.request("send_group_msg", {
      group_id: "987654",
      message: "hello",
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as { echo: string };

    transport.resolveActionResponse({
      status: "failed",
      retcode: 1400,
      data: null,
      message: "请求参数错误",
      echo: sentPayload.echo,
    });

    await expect(requestPromise).rejects.toMatchObject({
      message: "请求参数错误",
      meta: {
        reason: "ACTION_FAILED",
        retcode: 1400,
      },
    });
    await transport.stop();
  });

  it("should reject timed out request and ignore stale response", async () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const transport = new NapcatGatewayTransport({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 1000,
      onMessage: vi.fn(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    await transport.start();
    const socket = sockets[0];
    socket.emitOpen();

    const requestPromise = transport.request("send_group_msg", {
      group_id: "987654",
      message: "hello",
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as { echo: string };

    const rejectionAssertion = expect(requestPromise).rejects.toMatchObject({
      message: "NapCat 请求超时",
      meta: {
        reason: "REQUEST_TIMEOUT",
        action: "send_group_msg",
      },
    });
    await vi.advanceTimersByTimeAsync(1001);
    await rejectionAssertion;

    transport.resolveActionResponse({
      status: "ok",
      retcode: 0,
      data: { message_id: 1 },
      message: "",
      echo: sentPayload.echo,
    });

    await transport.stop();
  });

  it("should reject all pending requests when socket closes", async () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new NapcatGatewayTransport({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      onMessage: vi.fn(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    await transport.start();
    const socket = sockets[0];
    socket.emitOpen();

    const requestPromise = transport.request("send_group_msg", {
      group_id: "987654",
      message: "hello",
    });
    socket.emitClose(1006, "closed");

    await expect(requestPromise).rejects.toMatchObject({
      message: "NapCat websocket 已断开",
      meta: {
        reason: "SOCKET_CLOSED",
        code: 1006,
        socketReason: "closed",
      },
    });
    await transport.stop();
  });

  it("should not reconnect after stop", async () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const transport = new NapcatGatewayTransport({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      onMessage: vi.fn(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    await transport.start();
    const socket = sockets[0];
    socket.emitOpen();
    socket.emitClose(1006, "closed");

    await transport.stop();
    await vi.advanceTimersByTimeAsync(3001);

    expect(sockets).toHaveLength(1);
  });
});
