import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLogQueryService } from "../../src/ops/application/app-log-query.service.js";
import { AppLogHandler } from "../../src/ops/http/app-log.handler.js";

describe("AppLogHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should query logs via injected service", async () => {
    const result = {
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
      },
      items: [
        {
          id: 1,
          traceId: "trace-1",
          level: "info",
          message: "hello",
          metadata: {
            source: "test",
          },
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const queryList = vi.fn().mockResolvedValue(result);

    const appLogQueryService: AppLogQueryService = {
      queryList,
    };

    const handler = new AppLogHandler({ appLogQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/app-log/query?page=1&pageSize=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(queryList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
      }),
    );
  });
});
