import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LlmChatCallQueryService } from "../../src/ops/application/llm-chat-call-query.service.js";
import { LlmChatCallHandler } from "../../src/ops/http/llm-chat-call.handler.js";

describe("LlmChatCallHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should query llm chat calls via injected service", async () => {
    const result = {
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
      },
      items: [
        {
          id: 1,
          requestId: "req-1",
          seq: 1,
          provider: "openai",
          model: "gpt-test",
          scene: "agent",
          extension: null,
          status: "success",
          requestPayload: {},
          responsePayload: {},
          nativeRequestPayload: {},
          nativeResponsePayload: {},
          error: null,
          nativeError: null,
          latencyMs: 10,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const queryList = vi.fn().mockResolvedValue(result);
    const llmChatCallQueryService: LlmChatCallQueryService = {
      queryList,
      getDetail: vi.fn(),
    };

    const handler = new LlmChatCallHandler({ llmChatCallQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/llm-chat-call/query?page=1&pageSize=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      pagination: result.pagination,
      items: [
        expect.objectContaining({
          id: 1,
          requestId: "req-1",
          provider: "openai",
          model: "gpt-test",
          status: "success",
        }),
      ],
    });
    expect(queryList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
      }),
    );
  });

  it("should pass status filter to query service", async () => {
    const queryList = vi.fn().mockResolvedValue({
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
      },
      items: [],
    });
    const llmChatCallQueryService: LlmChatCallQueryService = {
      queryList,
      getDetail: vi.fn(),
    };

    const handler = new LlmChatCallHandler({ llmChatCallQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/llm-chat-call/query?page=1&pageSize=20&status=failed",
    });

    expect(response.statusCode).toBe(200);
    expect(queryList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        status: "failed",
      }),
    );
  });

  it("should pass provider and model filters to query service", async () => {
    const queryList = vi.fn().mockResolvedValue({
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
      },
      items: [],
    });
    const llmChatCallQueryService: LlmChatCallQueryService = {
      queryList,
      getDetail: vi.fn(),
    };

    const handler = new LlmChatCallHandler({ llmChatCallQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/llm-chat-call/query?page=1&pageSize=20&provider=openai&model=gpt-5.4",
    });

    expect(response.statusCode).toBe(200);
    expect(queryList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        provider: "openai",
        model: "gpt-5.4",
      }),
    );
  });

  it("should fetch detail by id via injected service", async () => {
    const detail = {
      id: 42,
      requestId: "req-42",
      seq: 1,
      provider: "openai",
      model: "gpt-test",
      scene: null,
      extension: null,
      status: "success",
      requestPayload: { messages: [] },
      responsePayload: { ok: true },
      nativeRequestPayload: null,
      nativeResponsePayload: null,
      error: null,
      nativeError: null,
      latencyMs: 12,
      createdAt: new Date().toISOString(),
    };
    const getDetail = vi.fn().mockResolvedValue(detail);
    const llmChatCallQueryService: LlmChatCallQueryService = {
      queryList: vi.fn(),
      getDetail,
    };

    const handler = new LlmChatCallHandler({ llmChatCallQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/llm-chat-call/42",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 42,
      requestId: "req-42",
      requestPayload: { messages: [] },
      responsePayload: { ok: true },
    });
    expect(getDetail).toHaveBeenCalledWith(42);
  });

  it("should reject non-numeric :id without invoking service", async () => {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ message: "请求参数不合法" });
      }
      throw error;
    });
    const getDetail = vi.fn();
    const llmChatCallQueryService: LlmChatCallQueryService = {
      queryList: vi.fn(),
      getDetail,
    };

    const handler = new LlmChatCallHandler({ llmChatCallQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/llm-chat-call/abc",
    });

    expect(response.statusCode).toBe(400);
    expect(getDetail).not.toHaveBeenCalled();
  });

  it("should reject non-positive :id without invoking service", async () => {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ message: "请求参数不合法" });
      }
      throw error;
    });
    const getDetail = vi.fn();
    const llmChatCallQueryService: LlmChatCallQueryService = {
      queryList: vi.fn(),
      getDetail,
    };

    const handler = new LlmChatCallHandler({ llmChatCallQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/llm-chat-call/0",
    });

    expect(response.statusCode).toBe(400);
    expect(getDetail).not.toHaveBeenCalled();
  });
});
