import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmChatCallQueryService } from "../../src/service/llm-chat-call-query.service.js";
import { LlmChatCallHandler } from "../../src/handler/llm-chat-call.handler.js";

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
          provider: "openai",
          model: "gpt-test",
          status: "success",
          requestPayload: {},
          responsePayload: {},
          error: null,
          latencyMs: 10,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const queryList = vi.fn().mockResolvedValue(result);
    const llmChatCallQueryService: LlmChatCallQueryService = {
      queryList,
    };

    const handler = new LlmChatCallHandler({ llmChatCallQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/llm-chat-call/query?page=1&pageSize=20",
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
