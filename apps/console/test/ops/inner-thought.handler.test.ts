import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { InnerThoughtQueryService } from "../../src/ops/application/inner-thought-query.service.js";
import { InnerThoughtHandler } from "../../src/ops/http/inner-thought.handler.js";

describe("InnerThoughtHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should query inner thoughts via injected service", async () => {
    const result = {
      pagination: { page: 1, pageSize: 20, total: 1 },
      items: [
        {
          id: 1,
          triggeredAt: new Date().toISOString(),
          outcome: "injected" as const,
          thought: "想翻翻那篇文章",
          runtimeKey: "root-agent",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const queryList = vi.fn().mockResolvedValue(result);
    const innerThoughtQueryService: InnerThoughtQueryService = { queryList };

    const handler = new InnerThoughtHandler({ innerThoughtQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/inner-thought/query?page=1&pageSize=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      pagination: result.pagination,
      items: [expect.objectContaining({ id: 1, outcome: "injected", thought: "想翻翻那篇文章" })],
    });
    expect(queryList).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
  });

  it("should pass outcome filter to query service", async () => {
    const queryList = vi.fn().mockResolvedValue({
      pagination: { page: 1, pageSize: 20, total: 0 },
      items: [],
    });
    const innerThoughtQueryService: InnerThoughtQueryService = { queryList };

    const handler = new InnerThoughtHandler({ innerThoughtQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/inner-thought/query?outcome=failed",
    });

    expect(response.statusCode).toBe(200);
    expect(queryList).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
  });

  it("should reject an unknown outcome without invoking service", async () => {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ message: "请求参数不合法" });
      }
      throw error;
    });
    const queryList = vi.fn();
    const innerThoughtQueryService: InnerThoughtQueryService = { queryList };

    const handler = new InnerThoughtHandler({ innerThoughtQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/inner-thought/query?outcome=bogus",
    });

    expect(response.statusCode).toBe(400);
    expect(queryList).not.toHaveBeenCalled();
  });
});
