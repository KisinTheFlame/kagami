import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NapcatGroupMessageProcessor } from "../../src/napcat/service/napcat-gateway/group-message-processor.js";
import { createAgentEventQueue, initTestLogger } from "./napcat-gateway.test-helper.js";

function expectEnqueuedGroupMessage(data: Record<string, unknown>) {
  return expect.objectContaining({
    type: "napcat_group_message",
    data: expect.objectContaining(data),
  });
}

describe("NapcatGroupMessageProcessor", () => {
  let logs = initTestLogger();

  const imageMessageAnalyzer = {
    analyzeImageSegment: vi.fn().mockResolvedValue("[图片: 一只橘猫趴在键盘上]"),
  };

  beforeEach(() => {
    logs = initTestLogger();
    imageMessageAnalyzer.analyzeImageSegment.mockClear();
    imageMessageAnalyzer.analyzeImageSegment.mockResolvedValue("[图片: 一只橘猫趴在键盘上]");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should publish listened group message events", async () => {
    const actionRequester = {
      request: vi.fn().mockResolvedValue({
        card: "测试成员",
        nickname: "备用昵称",
      }),
    };
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester,
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
    });

    const result = await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 654321,
      message_id: 9988,
      raw_message: "[CQ:at,qq=10001] hello group",
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
      time: 1710000000,
      sender: {
        card: "测试群名片",
        nickname: "测试昵称",
      },
    });

    expect(actionRequester.request).toHaveBeenCalledWith("get_group_member_info", {
      group_id: "987654",
      user_id: "10001",
      no_cache: false,
    });
    expect(eventQueue.enqueue).toHaveBeenCalledWith(
      expectEnqueuedGroupMessage({
        groupId: "987654",
        userId: "123456",
        nickname: "测试群名片",
        rawMessage: "{@测试成员(10001)} hello group",
        messageSegments: [
          {
            type: "at",
            data: {
              qq: "10001",
              name: "测试成员",
            },
          },
          {
            type: "text",
            data: {
              text: " hello group",
            },
          },
        ],
        messageId: 9988,
        time: 1710000000,
      }),
    );
    expect(result.groupMessageEvent).toEqual(
      expect.objectContaining({
        rawMessage: "{@测试成员(10001)} hello group",
        messageSegments: [
          {
            type: "at",
            data: {
              qq: "10001",
              name: "测试成员",
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
    );
  });

  it("should reuse cached group member display name within ttl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z"));

    const actionRequester = {
      request: vi.fn().mockResolvedValue({
        card: "缓存昵称",
      }),
    };
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester,
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
    });

    const payload = {
      post_type: "message",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 654321,
      raw_message: "[CQ:at,qq=10001] hi",
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
            text: " hi",
          },
        },
      ],
      time: 1710000000,
      sender: {
        card: "测试群名片",
      },
    };

    await processor.handle(payload);
    await processor.handle({
      ...payload,
      message_id: 1002,
      raw_message: "[CQ:at,qq=10001] again",
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
            text: " again",
          },
        },
      ],
    });

    expect(actionRequester.request).toHaveBeenCalledTimes(1);
    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      2,
      expectEnqueuedGroupMessage({
        rawMessage: "{@缓存昵称(10001)} again",
        messageSegments: [
          {
            type: "at",
            data: {
              qq: "10001",
              name: "缓存昵称",
            },
          },
          {
            type: "text",
            data: {
              text: " again",
            },
          },
        ],
      }),
    );
  });

  it("should ignore bot self group message events", async () => {
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
    });

    const result = await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 123456,
      raw_message: "hello",
      message: [
        {
          type: "text",
          data: {
            text: "hello",
          },
        },
      ],
      sender: {
        card: "测试群名片",
      },
    });

    expect(result.groupMessageEvent).toBeNull();
    expect(eventQueue.enqueue).not.toHaveBeenCalled();
  });

  it("should ignore realtime message_sent group events", async () => {
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
    });

    const result = await processor.handle({
      post_type: "message_sent",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 123456,
      raw_message: "hello",
      message: [
        {
          type: "text",
          data: {
            text: "hello",
          },
        },
      ],
      sender: {
        card: "测试群名片",
      },
    });

    expect(result.groupMessageEvent).toBeNull();
    expect(eventQueue.enqueue).not.toHaveBeenCalled();
  });

  it("should log publish failures without throwing", async () => {
    const eventQueue = createAgentEventQueue();
    eventQueue.enqueue.mockImplementation(() => {
      throw new Error("publish failed");
    });
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
    });

    await expect(
      processor.handle({
        post_type: "message",
        message_type: "group",
        group_id: "987654",
        user_id: 123456,
        self_id: 654321,
        raw_message: "hello",
        message: [
          {
            type: "text",
            data: {
              text: "hello",
            },
          },
        ],
        sender: {
          card: "测试群名片",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        groupMessageEvent: expect.objectContaining({
          rawMessage: "hello",
          messageSegments: [
            {
              type: "text",
              data: {
                text: "hello",
              },
            },
          ],
        }),
      }),
    );
    await Promise.resolve();

    expect(
      logs.some(log => log.metadata.event === "napcat.gateway.group_message_publish_failed"),
    ).toBe(true);
  });

  it("should render image segments into rawMessage", async () => {
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
    });

    await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 654321,
      raw_message: "你看这个[CQ:image,file=abc.jpg,url=https://example.com/cat.jpg]",
      message: [
        {
          type: "text",
          data: {
            text: "你看这个",
          },
        },
        {
          type: "image",
          data: {
            summary: "图片",
            file: "abc.jpg",
            sub_type: 0,
            url: "https://example.com/cat.jpg",
            file_size: "100",
          },
        },
      ],
      sender: {
        card: "测试群名片",
      },
    });

    expect(imageMessageAnalyzer.analyzeImageSegment).toHaveBeenCalledTimes(1);
    expect(eventQueue.enqueue).toHaveBeenCalledWith(
      expectEnqueuedGroupMessage({
        rawMessage: "你看这个[图片: 一只橘猫趴在键盘上]",
        messageSegments: [
          {
            type: "text",
            data: {
              text: "你看这个",
            },
          },
          {
            type: "image",
            data: {
              summary: "一只橘猫趴在键盘上",
              file: "abc.jpg",
              sub_type: 0,
              url: "https://example.com/cat.jpg",
              file_size: "100",
            },
          },
        ],
      }),
    );
  });

  it("should ignore face segments when rendering rawMessage", async () => {
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
    });

    await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 654321,
      raw_message: "前[CQ:face,id=66]后",
      message: [
        {
          type: "text",
          data: {
            text: "前",
          },
        },
        {
          type: "face",
          data: {
            id: "66",
            raw: {
              faceIndex: 66,
            },
            resultId: null,
            chainCount: null,
          },
        },
        {
          type: "text",
          data: {
            text: "后",
          },
        },
      ],
      sender: {
        card: "测试群名片",
      },
    });

    expect(eventQueue.enqueue).toHaveBeenCalledWith(
      expectEnqueuedGroupMessage({
        rawMessage: "前后",
      }),
    );
  });

  it("should fallback to placeholder when image analysis fails", async () => {
    imageMessageAnalyzer.analyzeImageSegment.mockResolvedValue("[图片]");
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
    });

    await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 654321,
      raw_message: "[CQ:image,file=failed.png,url=https://example.com/failed.png]",
      message: [
        {
          type: "image",
          data: {
            summary: "图片",
            file: "failed.png",
            sub_type: 0,
            url: "https://example.com/failed.png",
            file_size: "100",
          },
        },
      ],
      sender: {
        card: "测试群名片",
      },
    });

    expect(eventQueue.enqueue).toHaveBeenCalledWith(
      expectEnqueuedGroupMessage({
        rawMessage: "[图片]",
        messageSegments: [
          {
            type: "image",
            data: {
              summary: "图片",
              file: "failed.png",
              sub_type: 0,
              url: "https://example.com/failed.png",
              file_size: "100",
            },
          },
        ],
      }),
    );
  });

  it("should ignore group messages from other groups", async () => {
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
    });

    await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 654321,
      raw_message: "first group",
      message: [
        {
          type: "text",
          data: {
            text: "first group",
          },
        },
      ],
      sender: {
        card: "测试群名片",
      },
    });
    await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "000000",
      user_id: 123456,
      self_id: 654321,
      raw_message: "other group",
      message: [
        {
          type: "text",
          data: {
            text: "other group",
          },
        },
      ],
      sender: {
        card: "测试群名片",
      },
    });

    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      1,
      expectEnqueuedGroupMessage({
        groupId: "987654",
        rawMessage: "first group",
      }),
    );
    expect(eventQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("should keep group messages when only unsupported segments are present", async () => {
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
    });

    const result = await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 654321,
      raw_message: "[CQ:face,id=66]",
      message: [
        {
          type: "face",
          data: {
            id: "66",
            raw: {
              faceIndex: 66,
            },
            resultId: null,
            chainCount: null,
          },
        },
      ],
      sender: {
        card: "测试群名片",
      },
    });

    expect(result.groupMessageEvent).toEqual(
      expect.objectContaining({
        rawMessage: "",
        messageSegments: [
          {
            type: "face",
            data: {
              id: "66",
              raw: {
                faceIndex: 66,
              },
              resultId: null,
              chainCount: null,
            },
          },
        ],
      }),
    );
    expect(eventQueue.enqueue).toHaveBeenCalledWith(
      expectEnqueuedGroupMessage({
        rawMessage: "",
      }),
    );
  });

  it("should log payload and skip reasons when malformed history messages are skipped", async () => {
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: vi.fn(),
      imageMessageAnalyzer,
    });

    const historyPayload = {
      group_id: "987654",
      user_id: 123456,
      message_id: 9988,
      message: [],
      sender: {
        nickname: "测试昵称",
      },
    };

    const result = await processor.normalizeHistoricalGroupMessages([historyPayload]);

    expect(result).toEqual([]);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            event: "napcat.gateway.history_message_skipped",
            groupId: "987654",
            messageId: 9988,
            skipReasons: ["EMPTY_OR_INVALID_MESSAGE_SEGMENTS"],
            payload: historyPayload,
          }),
        }),
      ]),
    );
  });

  it("should keep self sent message_sent history messages in context payloads", async () => {
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: vi.fn(),
      imageMessageAnalyzer,
    });

    const result = await processor.normalizeHistoricalGroupMessages([
      {
        post_type: "message_sent",
        message_type: "group",
        message_sent_type: "self",
        group_id: "987654",
        user_id: 123456,
        self_id: 123456,
        message_id: 9988,
        time: 1710000000,
        message: [
          {
            type: "text",
            data: {
              text: "bot reply",
            },
          },
        ],
        sender: {
          card: "Kagami",
        },
      },
    ]);

    expect(result).toEqual([
      {
        groupId: "987654",
        userId: "123456",
        nickname: "Kagami",
        rawMessage: "bot reply",
        messageSegments: [
          {
            type: "text",
            data: {
              text: "bot reply",
            },
          },
        ],
        messageId: 9988,
        time: 1710000000,
      },
    ]);
    expect(logs.some(log => log.metadata.event === "napcat.gateway.history_message_skipped")).toBe(
      false,
    );
  });
});
