import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { StoryQueryService } from "../../src/ops/application/story-query.service.js";
import type { StoryReindexService } from "../../src/ops/application/story-reindex.service.js";
import { StoryHandler } from "../../src/ops/http/story.handler.js";

describe("StoryHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          message: "请求参数不合法",
        });
      }

      throw error;
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should query story list", async () => {
    const storyQueryService: StoryQueryService = {
      queryList: vi.fn().mockResolvedValue({
        pagination: {
          page: 1,
          pageSize: 20,
          total: 0,
        },
        items: [],
      }),
    };
    const storyReindexService: StoryReindexService = {
      reindex: vi.fn(),
    };

    new StoryHandler({ storyQueryService, storyReindexService }).register(app);

    const response = await app.inject({
      method: "GET",
      url: "/story/query?page=1&pageSize=20",
    });

    expect(response.statusCode).toBe(200);
    expect(storyQueryService.queryList).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
    });
  });

  it("should trigger story reindex with default request values", async () => {
    const storyQueryService: StoryQueryService = {
      queryList: vi.fn(),
    };
    const reindex = vi.fn().mockResolvedValue({
      mode: "outdated",
      totalStories: 10,
      targetedStories: 2,
      reindexedStories: 2,
      skippedStories: 8,
      failedStories: 0,
      failures: [],
    });
    const storyReindexService: StoryReindexService = {
      reindex,
    };

    new StoryHandler({ storyQueryService, storyReindexService }).register(app);

    const response = await app.inject({
      method: "POST",
      url: "/story/reindex",
    });

    expect(response.statusCode).toBe(200);
    expect(reindex).toHaveBeenCalledWith({
      mode: "outdated",
      pageSize: 50,
    });
    expect(response.json()).toEqual({
      mode: "outdated",
      totalStories: 10,
      targetedStories: 2,
      reindexedStories: 2,
      skippedStories: 8,
      failedStories: 0,
      failures: [],
    });
  });

  it("should reject invalid reindex mode", async () => {
    const storyQueryService: StoryQueryService = {
      queryList: vi.fn(),
    };
    const storyReindexService: StoryReindexService = {
      reindex: vi.fn(),
    };

    new StoryHandler({ storyQueryService, storyReindexService }).register(app);

    const response = await app.inject({
      method: "POST",
      url: "/story/reindex",
      payload: {
        mode: "invalid",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: "请求参数不合法",
    });
  });
});
