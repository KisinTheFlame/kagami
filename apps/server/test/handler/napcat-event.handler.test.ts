import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NapcatEventQueryService } from "../../src/service/napcat-event-query.service.js";
import { NapcatEventHandler } from "../../src/handler/napcat-event.handler.js";

describe("NapcatEventHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should query napcat events via injected service", async () => {
    const result = {
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
      },
      items: [
        {
          id: 1,
          postType: "message",
          messageType: "private",
          subType: "friend",
          userId: "123456",
          groupId: null,
          rawMessage: "hello",
          eventTime: new Date().toISOString(),
          payload: {
            post_type: "message",
          },
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const queryList = vi.fn().mockResolvedValue(result);
    const napcatEventQueryService: NapcatEventQueryService = {
      queryList,
    };

    const handler = new NapcatEventHandler({ napcatEventQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/napcat-event/query?page=1&pageSize=20&postType=message&userId=123456",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(queryList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        postType: "message",
        userId: "123456",
      }),
    );
  });
});
