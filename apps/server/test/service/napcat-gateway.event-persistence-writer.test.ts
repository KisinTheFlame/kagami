import { beforeEach, describe, expect, it, vi } from "vitest";
import { NapcatEventPersistenceWriter } from "../../src/service/napcat-gateway/event-persistence-writer.js";
import type { GroupMessageChunkIndexer } from "../../src/rag/indexer.service.js";
import {
  createNapcatEventDao,
  createNapcatGroupMessageChunkDao,
  createNapcatGroupMessageDao,
  initTestLogger,
  waitOneTick,
} from "./napcat-gateway.test-helper.js";

describe("NapcatEventPersistenceWriter", () => {
  let logs = initTestLogger();

  beforeEach(() => {
    logs = initTestLogger();
  });

  it("should persist post_type events into dao", async () => {
    const napcatEventDao = createNapcatEventDao();
    const writer = new NapcatEventPersistenceWriter({
      napcatEventDao,
    });

    writer.persistEvent({
      postType: "message",
      messageType: "private",
      subType: "friend",
      userId: "123456",
      selfId: null,
      groupId: null,
      nickname: null,
      rawMessage: "hi",
      messageSegments: [],
      messageId: 9988,
      time: 1710000000,
      eventTime: new Date(1710000000 * 1000),
      payload: {
        post_type: "message",
      },
    });
    await waitOneTick();

    expect(napcatEventDao.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        postType: "message",
        messageType: "private",
        subType: "friend",
        userId: "123456",
        payload: {
          post_type: "message",
        },
      }),
    );
    expect(napcatEventDao.insert.mock.calls[0]?.[0]).not.toHaveProperty("rawMessage");
  });

  it("should not persist blocked post_type events", async () => {
    const napcatEventDao = createNapcatEventDao();
    const writer = new NapcatEventPersistenceWriter({
      napcatEventDao,
    });

    writer.persistEvent({
      postType: "meta_event",
      messageType: null,
      subType: null,
      userId: null,
      selfId: null,
      groupId: null,
      nickname: null,
      rawMessage: null,
      messageSegments: [],
      messageId: null,
      time: null,
      eventTime: null,
      payload: {
        post_type: "meta_event",
      },
    });
    await waitOneTick();

    expect(napcatEventDao.insert).not.toHaveBeenCalled();
  });

  it("should persist group message and enqueue chunk indexing", async () => {
    const napcatGroupMessageDao = createNapcatGroupMessageDao();
    const napcatGroupMessageChunkDao = createNapcatGroupMessageChunkDao();
    const groupMessageChunkIndexer = {
      enqueue: vi.fn(),
    } as unknown as GroupMessageChunkIndexer;
    const writer = new NapcatEventPersistenceWriter({
      napcatGroupMessageDao,
      napcatGroupMessageChunkDao,
      groupMessageChunkIndexer,
    });

    writer.persistGroupMessage(
      {
        groupId: "987654",
        userId: "123456",
        nickname: "测试群名片",
        rawMessage: "hello group",
        messageSegments: [
          {
            type: "text",
            data: {
              text: "hello group",
            },
          },
        ],
        messageId: 9988,
        time: 1710000000,
        payload: {
          message: [
            {
              type: "text",
              data: {
                text: "hello group",
              },
            },
          ],
        },
      },
      new Date(1710000000 * 1000),
    );
    await waitOneTick();

    expect(napcatGroupMessageDao.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "987654",
        messageId: 9988,
        message: [
          {
            type: "text",
            data: {
              text: "hello group",
            },
          },
        ],
      }),
    );
    expect(napcatGroupMessageChunkDao.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "987654",
        status: "pending",
        content: "测试群名片 (123456):\nhello group",
      }),
    );
    expect(groupMessageChunkIndexer.enqueue).toHaveBeenCalledWith(101);
  });

  it("should log persistence failures without throwing", async () => {
    const napcatEventDao = createNapcatEventDao();
    napcatEventDao.insert.mockRejectedValue(new Error("db failed"));
    const writer = new NapcatEventPersistenceWriter({
      napcatEventDao,
    });

    writer.persistEvent({
      postType: "message",
      messageType: "private",
      subType: null,
      userId: "123456",
      selfId: null,
      groupId: null,
      nickname: null,
      rawMessage: "hi",
      messageSegments: [],
      messageId: 9988,
      time: 1710000000,
      eventTime: new Date(1710000000 * 1000),
      payload: {
        post_type: "message",
      },
    });
    await waitOneTick();

    expect(logs.some(log => log.metadata.event === "napcat.gateway.event_persist_failed")).toBe(
      true,
    );
  });
});
