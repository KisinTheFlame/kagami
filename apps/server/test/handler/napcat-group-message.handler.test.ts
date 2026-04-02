import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NapcatQqMessageQueryService } from "../../src/ops/application/napcat-group-message-query.service.js";
import { NapcatQqMessageHandler } from "../../src/ops/http/napcat-group-message.handler.js";

describe("NapcatQqMessageHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should query napcat qq messages via injected service", async () => {
    const result = {
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
      },
      items: [
        {
          id: 1,
          messageType: "group",
          subType: "normal",
          groupId: "987654",
          userId: "123456",
          nickname: "测试昵称",
          messageId: 9988,
          message: [
            {
              type: "text",
              data: {
                text: "hello group",
              },
            },
          ],
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
    const napcatQqMessageQueryService: NapcatQqMessageQueryService = {
      queryList,
    };

    const handler = new NapcatQqMessageHandler({ napcatQqMessageQueryService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/napcat-group-message/query?page=1&pageSize=20&messageType=group&groupId=987654&userId=123456&nickname=%E6%B5%8B%E8%AF%95",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(queryList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        messageType: "group",
        groupId: "987654",
        userId: "123456",
        nickname: "测试",
      }),
    );
  });
});
