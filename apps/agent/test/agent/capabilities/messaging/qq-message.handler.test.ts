import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { QqMessageHandler } from "../../../../src/agent/capabilities/messaging/http/qq-message.handler.js";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";

/** 收口后 QqMessageHandler 只依赖 2 方法的出站端口（QQ App 的 outboundService 形状）。 */
type QqMessageSender = {
  sendGroupMessage(input: { groupId: string; message: string }): Promise<{ messageId: number }>;
  sendPrivateMessage(input: { userId: string; message: string }): Promise<{ messageId: number }>;
};

function fakeSender(overrides: Partial<QqMessageSender> = {}): QqMessageSender {
  return {
    sendGroupMessage: vi.fn().mockResolvedValue({ messageId: 1 }),
    sendPrivateMessage: vi.fn().mockResolvedValue({ messageId: 1 }),
    ...overrides,
  };
}

describe("QqMessageHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    initTestLoggerRuntime();
    app = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          message: "请求参数不合法",
        });
      }

      if (error instanceof BizError) {
        return reply.code(500).send({
          message: error.message,
        });
      }

      throw error;
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should send group message via the injected outbound sender", async () => {
    const sendGroupMessage = vi.fn().mockResolvedValue({ messageId: 654321 });
    const handler = new QqMessageHandler({ qqMessageSender: fakeSender({ sendGroupMessage }) });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/group/send",
      payload: {
        groupId: "1122334455",
        message: "hello group",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ messageId: 654321 });
    expect(sendGroupMessage).toHaveBeenCalledWith({
      groupId: "1122334455",
      message: "hello group",
    });
  });

  it("should return 400 when request payload is invalid", async () => {
    const sendGroupMessage = vi.fn();
    const handler = new QqMessageHandler({ qqMessageSender: fakeSender({ sendGroupMessage }) });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/group/send",
      payload: {
        groupId: "1122334455",
        message: "",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(sendGroupMessage).not.toHaveBeenCalled();
  });

  it("should return 500 when the sender raises upstream error", async () => {
    const sendGroupMessage = vi.fn().mockRejectedValue(
      new BizError({
        message: "NapCat 请求发送失败",
      }),
    );
    const handler = new QqMessageHandler({ qqMessageSender: fakeSender({ sendGroupMessage }) });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/group/send",
      payload: {
        groupId: "1122334455",
        message: "hello",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      message: "NapCat 请求发送失败",
    });
  });

  it("should return 400 when groupId is missing", async () => {
    const sendGroupMessage = vi.fn();
    const handler = new QqMessageHandler({ qqMessageSender: fakeSender({ sendGroupMessage }) });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/group/send",
      payload: {
        message: "hello group",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(sendGroupMessage).not.toHaveBeenCalled();
  });

  it("should send private message via the injected outbound sender", async () => {
    const sendPrivateMessage = vi.fn().mockResolvedValue({ messageId: 7654321 });
    const handler = new QqMessageHandler({ qqMessageSender: fakeSender({ sendPrivateMessage }) });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/private/send",
      payload: {
        userId: "123",
        message: "hello",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ messageId: 7654321 });
    expect(sendPrivateMessage).toHaveBeenCalledWith({
      userId: "123",
      message: "hello",
    });
  });

  it("should return 400 when private request payload is invalid", async () => {
    const handler = new QqMessageHandler({ qqMessageSender: fakeSender() });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/private/send",
      payload: {
        userId: "123",
        message: "",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should return 500 when private send fails", async () => {
    const sendPrivateMessage = vi.fn().mockRejectedValue(
      new BizError({
        message: "NapCat 私聊发送失败",
      }),
    );
    const handler = new QqMessageHandler({ qqMessageSender: fakeSender({ sendPrivateMessage }) });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/private/send",
      payload: {
        userId: "123",
        message: "hello",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      message: "NapCat 私聊发送失败",
    });
    expect(sendPrivateMessage).toHaveBeenCalledWith({
      userId: "123",
      message: "hello",
    });
  });
});
