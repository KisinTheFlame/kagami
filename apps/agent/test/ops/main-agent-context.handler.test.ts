import Fastify from "fastify";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MainAgentContextQueryService } from "../../src/ops/application/main-agent-context-query.service.js";
import { MainAgentContextHandler } from "../../src/ops/http/main-agent-context.handler.js";

describe("MainAgentContextHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
    // 生产 runtime 的 setErrorHandler 把 ZodError 统一打成 400（server-runtime.ts），
    // 裸 Fastify 没有这层，入参校验用例需要把它补上才测得出真实状态码。
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ message: "请求参数不合法" });
      }
      return reply.code(500).send({ message: "internal" });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should return the recent main agent context snapshot", async () => {
    const getRecentSnapshot = vi.fn().mockResolvedValue({
      generatedAt: "2026-03-30T08:00:00.000Z",
      recentItems: [],
      recentItemsTruncated: false,
    });
    const mainAgentContextQueryService: MainAgentContextQueryService = {
      getRecentSnapshot,
      compactContext: vi.fn(),
    };
    const handler = new MainAgentContextHandler({
      mainAgentContextQueryService,
    });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/main-agent-context/recent",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      generatedAt: "2026-03-30T08:00:00.000Z",
      recentItems: [],
      recentItemsTruncated: false,
    });
    expect(getRecentSnapshot).toHaveBeenCalledTimes(1);
  });

  it("should pass the compress ratio through and return the compaction counts", async () => {
    const compactContext = vi.fn().mockResolvedValue({
      compacted: true,
      compactedAt: "2026-03-30T08:00:00.000Z",
      summarizedCount: 18,
      keptCount: 2,
      appliedCompressRatio: 90,
    });
    const mainAgentContextQueryService: MainAgentContextQueryService = {
      getRecentSnapshot: vi.fn(),
      compactContext,
    };
    const handler = new MainAgentContextHandler({
      mainAgentContextQueryService,
    });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/main-agent-context/compact",
      payload: { compressRatio: 90 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      compacted: true,
      compactedAt: "2026-03-30T08:00:00.000Z",
      summarizedCount: 18,
      keptCount: 2,
      appliedCompressRatio: 90,
    });
    expect(compactContext).toHaveBeenCalledWith({ compressRatio: 90 });
  });

  it.each([
    ["缺参数", {}],
    ["越界下限", { compressRatio: 9 }],
    ["越界上限", { compressRatio: 101 }],
    ["非整数", { compressRatio: 90.5 }],
    ["非数字", { compressRatio: "90" }],
  ])("should reject an invalid compress ratio: %s", async (_label, payload) => {
    const compactContext = vi.fn();
    const mainAgentContextQueryService: MainAgentContextQueryService = {
      getRecentSnapshot: vi.fn(),
      compactContext,
    };
    const handler = new MainAgentContextHandler({
      mainAgentContextQueryService,
    });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/main-agent-context/compact",
      payload,
    });

    expect(response.statusCode).toBe(400);
    // 校验不过一律不落到 summarizer，避免白烧一次 LLM 调用。
    expect(compactContext).not.toHaveBeenCalled();
  });
});
