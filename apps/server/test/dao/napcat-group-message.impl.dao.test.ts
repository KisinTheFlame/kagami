import { describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@kagami/shared";
import type { Database } from "../../src/db/client.js";
import { PrismaNapcatGroupMessageDao } from "../../src/dao/impl/napcat-group-message.impl.dao.js";

describe("PrismaNapcatGroupMessageDao", () => {
  it("should persist structured message into message column", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const database = {
      napcatGroupMessage: {
        create,
      },
    } as unknown as Database;

    const dao = new PrismaNapcatGroupMessageDao({ database });
    const message: JsonValue = [
      {
        type: "text",
        data: {
          text: "hello group",
        },
      },
    ];

    await dao.insert({
      groupId: "987654",
      userId: "123456",
      nickname: "测试昵称",
      messageId: 9988,
      message,
      eventTime: new Date("2026-03-10T10:00:00.000Z"),
      payload: {
        post_type: "message",
        message_type: "group",
        message,
      },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        groupId: "987654",
        userId: "123456",
        nickname: "测试昵称",
        messageId: 9988,
        message,
        payload: {
          post_type: "message",
          message_type: "group",
          message,
        },
      }),
    });
  });

  it("should query with prisma when keyword is absent", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 1,
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
        eventTime: new Date("2026-03-10T10:00:00.000Z"),
        payload: {
          post_type: "message",
        },
        createdAt: new Date("2026-03-10T10:00:01.000Z"),
      },
    ]);
    const queryRaw = vi.fn();
    const database = {
      napcatGroupMessage: {
        count,
        findMany,
      },
      $queryRaw: queryRaw,
    } as unknown as Database;

    const dao = new PrismaNapcatGroupMessageDao({ database });

    await expect(
      dao.countByQuery({
        groupId: "987654",
      }),
    ).resolves.toBe(1);

    await expect(
      dao.listByQueryPage({
        page: 1,
        pageSize: 20,
        groupId: "987654",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        groupId: "987654",
        message: [
          {
            type: "text",
            data: {
              text: "hello group",
            },
          },
        ],
      }),
    ]);

    expect(count).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("should query json text with raw sql when keyword is present", async () => {
    const count = vi.fn();
    const findMany = vi.fn();
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ total: "2" }])
      .mockResolvedValueOnce([
        {
          id: 1,
          groupId: "987654",
          userId: "123456",
          nickname: "测试昵称",
          messageId: 9988,
          message: [
            {
              type: "at",
              data: {
                qq: "10001",
              },
            },
            {
              type: "text",
              data: {
                text: " hello group",
              },
            },
          ],
          eventTime: new Date("2026-03-10T10:00:00.000Z"),
          payload: {
            post_type: "message",
          },
          createdAt: new Date("2026-03-10T10:00:01.000Z"),
        },
      ]);
    const database = {
      napcatGroupMessage: {
        count,
        findMany,
      },
      $queryRaw: queryRaw,
    } as unknown as Database;

    const dao = new PrismaNapcatGroupMessageDao({ database });

    await expect(
      dao.countByQuery({
        keyword: "10001",
      }),
    ).resolves.toBe(2);

    await expect(
      dao.listByQueryPage({
        page: 1,
        pageSize: 20,
        keyword: "10001",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        message: [
          {
            type: "at",
            data: {
              qq: "10001",
            },
          },
          {
            type: "text",
            data: {
              text: " hello group",
            },
          },
        ],
      }),
    ]);

    expect(count).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
