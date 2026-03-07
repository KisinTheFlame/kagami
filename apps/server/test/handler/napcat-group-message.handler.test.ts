import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NapcatGroupMessageQueryService } from "../../src/service/napcat-group-message-query.service.js";
import { NapcatGroupMessageHandler } from "../../src/handler/napcat-group-message.handler.js";

describe("NapcatGroupMessageHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should query napcat group messages via injected service", async () => {
    const result = {
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
      },
      items: [
        {
          id: 1,
          groupId: "987654",
          userId: "123456",
          nickname: "测试昵称",
          messageId: 9988,
          rawMessage: "hello group",
          eventTime: new Date().toISOString(),
          payload: {
            post_type: "message",
            message_type: "group",
          },
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const queryList = vi.fn().mockResolvedValue(result);
    const napcatGroupMessageQueryService: NapcatGroupMessageQueryService = {
      queryList,
    };

    const handler = new NapcatGroupMessageHandler({ napcatGroupMessageQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/napcat-group-message/query?page=1&pageSize=20&groupId=987654&userId=123456&nickname=%E6%B5%8B%E8%AF%95",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(queryList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        groupId: "987654",
        userId: "123456",
        nickname: "测试",
      }),
    );
  });
});
