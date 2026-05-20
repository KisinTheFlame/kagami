import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MainAgentContextQueryService } from "../../src/ops/application/main-agent-context-query.service.js";
import { MainAgentContextHandler } from "../../src/ops/http/main-agent-context.handler.js";

describe("MainAgentContextHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
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
});
