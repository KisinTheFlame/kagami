import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "@kagami/shared";
import { NapcatHandler } from "../../src/handler/napcat.handler.js";
import { NapcatGatewayError } from "../../src/service/napcat-gateway.service.js";
import type { NapcatGatewayService } from "../../src/service/napcat-gateway.service.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

describe("NapcatHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    initTestLoggerRuntime();
    app = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          code: "BAD_REQUEST",
          message: "请求参数不合法",
        });
      }

      if (error instanceof NapcatGatewayError) {
        return reply.code(502).send({
          code: "NAPCAT_UPSTREAM_ERROR",
          message: "NapCat 上游服务不可用",
        });
      }

      throw error;
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should send private message via injected NapCat gateway", async () => {
    const sendPrivateText = vi.fn().mockResolvedValue({ messageId: 123456 });
    const sendGroupText = vi.fn().mockResolvedValue({ messageId: 654321 });
    const napcatGatewayService: NapcatGatewayService = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendPrivateText,
      sendGroupText,
    };

    const handler = new NapcatHandler({ napcatGatewayService });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/private/send",
      payload: {
        userId: "2987345656",
        message: "hello",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ messageId: 123456 });
    expect(sendPrivateText).toHaveBeenCalledWith({
      userId: "2987345656",
      message: "hello",
    });
  });

  it("should send group message via injected NapCat gateway", async () => {
    const sendPrivateText = vi.fn().mockResolvedValue({ messageId: 123456 });
    const sendGroupText = vi.fn().mockResolvedValue({ messageId: 654321 });
    const napcatGatewayService: NapcatGatewayService = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendPrivateText,
      sendGroupText,
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
    expect(sendGroupText).toHaveBeenCalledWith({
      groupId: "1122334455",
      message: "hello group",
    });
  });

  it("should return 400 when request payload is invalid", async () => {
    const sendPrivateText = vi.fn();
    const sendGroupText = vi.fn();
    const napcatGatewayService: NapcatGatewayService = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendPrivateText,
      sendGroupText,
    };

    const handler = new NapcatHandler({ napcatGatewayService });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/private/send",
      payload: {
        userId: "",
        message: "",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(sendPrivateText).not.toHaveBeenCalled();
    expect(sendGroupText).not.toHaveBeenCalled();
  });

  it("should return 502 when NapCat gateway raises upstream error", async () => {
    const sendPrivateText = vi.fn().mockRejectedValue(
      new NapcatGatewayError({
        code: "UPSTREAM_ERROR",
        message: "boom",
      }),
    );
    const sendGroupText = vi.fn().mockResolvedValue({ messageId: 654321 });
    const napcatGatewayService: NapcatGatewayService = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendPrivateText,
      sendGroupText,
    };

    const handler = new NapcatHandler({ napcatGatewayService });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/napcat/private/send",
      payload: {
        userId: "2987345656",
        message: "hello",
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      code: "NAPCAT_UPSTREAM_ERROR",
      message: "NapCat 上游服务不可用",
    });
  });
});
