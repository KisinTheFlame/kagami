import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BizError } from "../../src/common/errors/biz-error.js";
import { NapcatHandler } from "../../src/napcat/http/napcat.handler.js";
import type { NapcatGatewayService } from "../../src/napcat/service/napcat-gateway.service.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

describe("NapcatHandler", () => {
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

  it("should send group message via injected NapCat gateway", async () => {
    const sendGroupMessage = vi.fn().mockResolvedValue({ messageId: 654321 });
    const napcatGatewayService: NapcatGatewayService = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendGroupMessage,
      getGroupInfo: vi.fn(),
      getRecentGroupMessages: vi.fn().mockResolvedValue([]),
    };

    const handler = new NapcatHandler({ napcatGatewayService });
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
    const napcatGatewayService: NapcatGatewayService = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendGroupMessage,
      getGroupInfo: vi.fn(),
      getRecentGroupMessages: vi.fn().mockResolvedValue([]),
    };

    const handler = new NapcatHandler({ napcatGatewayService });
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

  it("should return 502 when NapCat gateway raises upstream error", async () => {
    const sendGroupMessage = vi.fn().mockRejectedValue(
      new BizError({
        message: "NapCat 请求发送失败",
      }),
    );
    const napcatGatewayService: NapcatGatewayService = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendGroupMessage,
      getGroupInfo: vi.fn(),
      getRecentGroupMessages: vi.fn().mockResolvedValue([]),
    };

    const handler = new NapcatHandler({ napcatGatewayService });
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
    const napcatGatewayService: NapcatGatewayService = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendGroupMessage,
      getGroupInfo: vi.fn(),
      getRecentGroupMessages: vi.fn().mockResolvedValue([]),
    };

    const handler = new NapcatHandler({ napcatGatewayService });
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

  it("should remove private send route", async () => {
    const napcatGatewayService: NapcatGatewayService = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendGroupMessage: vi.fn().mockResolvedValue({ messageId: 1 }),
      getGroupInfo: vi.fn(),
      getRecentGroupMessages: vi.fn().mockResolvedValue([]),
    };

    const handler = new NapcatHandler({ napcatGatewayService });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/private/send",
      payload: {
        userId: "123",
        message: "hello",
      },
    });

    expect(response.statusCode).toBe(404);
  });
});
