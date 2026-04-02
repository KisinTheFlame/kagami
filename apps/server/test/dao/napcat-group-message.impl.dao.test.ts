import { describe, expect, it, vi } from "vitest";
import { type JsonValue } from "@kagami/shared/schemas/base";
import type { Database } from "../../src/db/client.js";
import { PrismaNapcatQqMessageDao } from "../../src/napcat/dao/impl/napcat-group-message.impl.dao.js";

describe("PrismaNapcatQqMessageDao", () => {
  it("should persist structured message into message column", async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const database = {
      napcatQqMessage: {
        create,
      },
    } as unknown as Database;

    const dao = new PrismaNapcatQqMessageDao({ database });
    const message: JsonValue = [
      {
        type: "text",
        data: {
          text: "hello group",
        },
      },
    ];

    await expect(
      dao.insert({
        messageType: "group",
        subType: "normal",
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
      }),
    ).resolves.toBe(1);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageType: "group",
        subType: "normal",
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
      select: {
        id: true,
      },
    });
  });

  it("should query with prisma when keyword is absent", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([
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
        eventTime: new Date("2026-03-10T10:00:00.000Z"),
        payload: {
          post_type: "message",
        },
        createdAt: new Date("2026-03-10T10:00:01.000Z"),
      },
    ]);
    const queryRaw = vi.fn();
    const database = {
      napcatQqMessage: {
        count,
        findMany,
      },
      $queryRaw: queryRaw,
    } as unknown as Database;

    const dao = new PrismaNapcatQqMessageDao({ database });

    await expect(
      dao.countByQuery({
        messageType: "group",
        groupId: "987654",
      }),
    ).resolves.toBe(1);

    await expect(
      dao.listByQueryPage({
        page: 1,
        pageSize: 20,
        messageType: "group",
        groupId: "987654",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        messageType: "group",
        subType: "normal",
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
          messageType: "private",
          subType: "friend",
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
      napcatQqMessage: {
        count,
        findMany,
      },
      $queryRaw: queryRaw,
    } as unknown as Database;

    const dao = new PrismaNapcatQqMessageDao({ database });

    await expect(
      dao.countByQuery({
        messageType: "private",
        keyword: "10001",
      }),
    ).resolves.toBe(2);

    await expect(
      dao.listByQueryPage({
        page: 1,
        pageSize: 20,
        messageType: "private",
        keyword: "10001",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        messageType: "private",
        subType: "friend",
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

  it("should load a same-group context window ordered by message time", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: 10,
        groupId: "987654",
        userId: "123456",
        nickname: "甲",
        messageText: "前文",
        eventTime: new Date("2026-03-10T10:00:00.000Z"),
        createdAt: new Date("2026-03-10T10:00:01.000Z"),
      },
      {
        id: 11,
        groupId: "987654",
        userId: "123457",
        nickname: "乙",
        messageText: "命中",
        eventTime: new Date("2026-03-10T10:00:02.000Z"),
        createdAt: new Date("2026-03-10T10:00:03.000Z"),
      },
    ]);
    const database = {
      napcatQqMessage: {
        create: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
      $queryRaw: queryRaw,
    } as unknown as Database;

    const dao = new PrismaNapcatQqMessageDao({ database });

    await expect(
      dao.listContextWindowById({
        groupId: "987654",
        messageId: 11,
        before: 2,
        after: 2,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 10,
        messageText: "前文",
      }),
      expect.objectContaining({
        id: 11,
        messageText: "命中",
      }),
    ]);
  });
});
