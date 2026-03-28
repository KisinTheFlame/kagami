import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/db/client.js";
import { PrismaNapcatEventDao } from "../../src/napcat/dao/impl/napcat-event.impl.dao.js";

describe("PrismaNapcatEventDao", () => {
  it("should persist event payload without rawMessage column", async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const database = {
      napcatEvent: {
        create,
      },
    } as unknown as Database;

    const dao = new PrismaNapcatEventDao({ database });

    await expect(
      dao.insert({
        postType: "message",
        messageType: "group",
        subType: "normal",
        userId: "123456",
        groupId: "987654",
        eventTime: new Date("2026-03-28T01:00:00.000Z"),
        payload: {
          post_type: "message",
          message_type: "group",
        },
      }),
    ).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        postType: "message",
        messageType: "group",
        subType: "normal",
        userId: "123456",
        groupId: "987654",
        payload: {
          post_type: "message",
          message_type: "group",
        },
      }),
    });
    expect(create.mock.calls[0]?.[0]?.data).not.toHaveProperty("rawMessage");
  });

  it("should query via prisma filters without keyword support", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 1,
        postType: "message",
        messageType: "group",
        subType: "normal",
        userId: "123456",
        groupId: "987654",
        eventTime: new Date("2026-03-28T01:00:00.000Z"),
        payload: {
          post_type: "message",
        },
        createdAt: new Date("2026-03-28T01:00:01.000Z"),
      },
    ]);
    const database = {
      napcatEvent: {
        count,
        findMany,
      },
    } as unknown as Database;

    const dao = new PrismaNapcatEventDao({ database });

    await expect(
      dao.countByQuery({
        postType: "message",
        messageType: "group",
        userId: "123456",
        startAt: "2026-03-28T00:00:00.000Z",
        endAt: "2026-03-29T00:00:00.000Z",
      }),
    ).resolves.toBe(1);

    await expect(
      dao.listByQueryPage({
        page: 1,
        pageSize: 20,
        postType: "message",
        messageType: "group",
        userId: "123456",
        startAt: "2026-03-28T00:00:00.000Z",
        endAt: "2026-03-29T00:00:00.000Z",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        postType: "message",
        groupId: "987654",
      }),
    ]);

    expect(count).toHaveBeenCalledWith({
      where: {
        postType: "message",
        messageType: "group",
        userId: "123456",
        createdAt: {
          gte: new Date("2026-03-28T00:00:00.000Z"),
          lte: new Date("2026-03-29T00:00:00.000Z"),
        },
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        postType: "message",
        messageType: "group",
        userId: "123456",
        createdAt: {
          gte: new Date("2026-03-28T00:00:00.000Z"),
          lte: new Date("2026-03-29T00:00:00.000Z"),
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      skip: 0,
    });
  });
});
