import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NapcatGroupMessageProcessor } from "../../src/service/napcat-gateway/group-message-processor.js";
import { createAgentEventQueue, initTestLogger } from "./napcat-gateway.test-helper.js";

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
    expect(eventQueue.enqueue).toHaveBeenCalledWith({
      type: "napcat_group_message",
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
    });
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
      expect.objectContaining({
        type: "napcat_group_message",
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
        sender: {
          card: "测试群名片",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        groupMessageEvent: expect.objectContaining({
          rawMessage: "hello",
          messageSegments: [],
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
      expect.objectContaining({
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
      expect.objectContaining({
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

  it("should publish events for each listened group independently", async () => {
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654", "123456"],
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
      sender: {
        card: "测试群名片",
      },
    });
    await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "123456",
      user_id: 123456,
      self_id: 654321,
      raw_message: "second group",
      sender: {
        card: "测试群名片",
      },
    });

    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        groupId: "987654",
        rawMessage: "first group",
      }),
    );
    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        groupId: "123456",
        rawMessage: "second group",
      }),
    );
  });
});
