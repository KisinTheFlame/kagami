import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoQueryService } from "../../src/ops/application/todo-query.service.js";
import { TodoHandler } from "../../src/ops/http/todo.handler.js";

describe("TodoHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should query todos via injected service", async () => {
    const result = {
      pagination: { page: 1, pageSize: 20, total: 1 },
      items: [
        {
          id: 1,
          title: "写周报",
          note: null,
          status: "pending",
          remindAt: null,
          repeatEveryMs: null,
          snoozedUntil: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
        },
      ],
    };
    const queryList = vi.fn().mockResolvedValue(result);

    const todoQueryService: TodoQueryService = { queryList };

    const handler = new TodoHandler({ todoQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/todo/query?page=1&pageSize=20&status=pending",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(queryList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20, status: "pending" }),
    );
  });

  it("should default to no status filter when omitted", async () => {
    const queryList = vi.fn().mockResolvedValue({
      pagination: { page: 1, pageSize: 20, total: 0 },
      items: [],
    });
    const handler = new TodoHandler({ todoQueryService: { queryList } });
    handler.register(app);

    const response = await app.inject({ method: "GET", url: "/todo/query?page=1&pageSize=20" });

    expect(response.statusCode).toBe(200);
    expect(queryList).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
    expect(queryList.mock.calls[0]?.[0]?.status).toBeUndefined();
  });
});
