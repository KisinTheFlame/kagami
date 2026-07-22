import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NapcatGroupMessageProcessor } from "../src/application/napcat-gateway/group-message-processor.js";
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
    analyzeImageSegment: vi
      .fn()
      .mockResolvedValue({ description: "一只橘猫趴在键盘上", resid: null }),
  };

  const qqMessageDao = {
    insert: vi.fn(),
    findByNapcatMessageId: vi.fn().mockResolvedValue(null),
    countByQuery: vi.fn(),
    listByQueryPage: vi.fn(),
    listContextWindowById: vi.fn(),
    deleteOlderThan: vi.fn(),
  };

  beforeEach(() => {
    logs = initTestLogger();
    imageMessageAnalyzer.analyzeImageSegment.mockClear();
    imageMessageAnalyzer.analyzeImageSegment.mockResolvedValue({
      description: "一只橘猫趴在键盘上",
      resid: null,
    });
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
      qqMessageDao,
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
      qqMessageDao,
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
      qqMessageDao,
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
      qqMessageDao,
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
      qqMessageDao,
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
      qqMessageDao,
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

  it("should render face segments via the face name map when faceText is absent", async () => {
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
      qqMessageDao,
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
        rawMessage: "前[表情: 爱心]后",
      }),
    );
  });

  it("should render face segments using faceText when present", async () => {
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
      qqMessageDao,
    });

    await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 654321,
      raw_message: "[CQ:face,id=319]",
      message: [
        {
          type: "face",
          data: {
            id: "319",
            raw: {
              faceIndex: 319,
              faceText: "/比心",
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

    expect(eventQueue.enqueue).toHaveBeenCalledWith(
      expectEnqueuedGroupMessage({
        rawMessage: "[表情: 比心]",
      }),
    );
  });

  it("should fallback to placeholder when image analysis fails", async () => {
    imageMessageAnalyzer.analyzeImageSegment.mockResolvedValue({ description: "", resid: null });
    const eventQueue = createAgentEventQueue();
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: eventQueue.enqueue,
      imageMessageAnalyzer,
      qqMessageDao,
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
      qqMessageDao,
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
      qqMessageDao,
    });

    const result = await processor.handle({
      post_type: "message",
      message_type: "group",
      group_id: "987654",
      user_id: 123456,
      self_id: 654321,
      raw_message: "[CQ:dice,result=5]",
      message: [
        {
          type: "dice",
          data: {
            result: "5",
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
            type: "dice",
            data: {
              result: "5",
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
      qqMessageDao,
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
      qqMessageDao,
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

  it("normalizeForwardMessages reuses vision for images and placeholders nested forwards", async () => {
    const processor = new NapcatGroupMessageProcessor({
      listenGroupIds: ["987654"],
      actionRequester: {
        request: vi.fn(),
      },
      enqueueGroupMessageEvent: vi.fn(),
      imageMessageAnalyzer,
      qqMessageDao,
    });

    const nodes = await processor.normalizeForwardMessages([
      // 扁平节点：纯文本
      {
        user_id: 10001,
        time: 1710000000,
        message: [{ type: "text", data: { text: "上午开会" } }],
        sender: { nickname: "小明" },
      },
      // 扁平节点：图片，应复用同一个 analyzeImageSegment
      {
        user_id: 10002,
        time: 1710000001,
        message: [
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
        sender: { nickname: "小红" },
      },
      // 包裹节点 { type:"node", data:{ content } } + 嵌套合并转发，应只渲染成占位符
      {
        type: "node",
        data: {
          user_id: 10003,
          nickname: "小刚",
          content: [{ type: "forward", data: { id: "999" } }],
        },
      },
    ]);

    expect(imageMessageAnalyzer.analyzeImageSegment).toHaveBeenCalledTimes(1);
    expect(nodes).toEqual([
      { senderName: "小明", senderUserId: "10001", rawMessage: "上午开会", time: 1710000000 },
      {
        senderName: "小红",
        senderUserId: "10002",
        rawMessage: "[图片: 一只橘猫趴在键盘上]",
        time: 1710000001,
      },
      {
        senderName: "小刚",
        senderUserId: "10003",
        rawMessage: "[forward_id: fwd-999]",
        time: null,
      },
    ]);
  });

  describe("group_ban notice 归一化", () => {
    function nameRequester() {
      // 按 user_id 返回群名片；ban 事件的 operator/target 名解析复用该缓存路径。
      return {
        request: vi.fn().mockImplementation((_action: string, params: Record<string, unknown>) => {
          const names: Record<string, string> = { "10001": "张三", "10002": "李四" };
          return Promise.resolve({ card: names[String(params.user_id)] ?? "" });
        }),
      };
    }

    function makeProcessor(actionRequester: { request: ReturnType<typeof vi.fn> }) {
      return new NapcatGroupMessageProcessor({
        listenGroupIds: ["987654"],
        actionRequester,
        enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
        imageMessageAnalyzer,
        qqMessageDao,
      });
    }

    it("ban：解析被禁言人 / 操作者名、时长；user_id!=0 为定向禁言", async () => {
      const processor = makeProcessor(nameRequester());
      const { groupBanEvent } = await processor.process({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "ban",
        group_id: 987654,
        operator_id: 10001,
        user_id: 10002,
        duration: 600,
        self_id: 10003,
        time: 1783000000,
      });
      expect(groupBanEvent).toEqual({
        groupId: "987654",
        subType: "ban",
        targetUserId: "10002",
        targetName: "李四",
        operatorUserId: "10001",
        operatorName: "张三",
        durationSeconds: 600,
        time: 1783000000,
      });
    });

    it("lift_ban：durationSeconds 归 0", async () => {
      const processor = makeProcessor(nameRequester());
      const { groupBanEvent } = await processor.process({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "lift_ban",
        group_id: 987654,
        operator_id: 10001,
        user_id: 10002,
        duration: 0,
        time: 1783000000,
      });
      expect(groupBanEvent).toMatchObject({ subType: "lift_ban", durationSeconds: 0 });
    });

    it("全员禁言（user_id=0）：targetUserId 归 null", async () => {
      const processor = makeProcessor(nameRequester());
      const { groupBanEvent } = await processor.process({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "ban",
        group_id: 987654,
        operator_id: 10001,
        user_id: 0,
        duration: 600,
        time: 1783000000,
      });
      expect(groupBanEvent).toMatchObject({ targetUserId: null, targetName: null });
    });

    it("非监听群：不产生 groupBanEvent", async () => {
      const processor = makeProcessor(nameRequester());
      const { groupBanEvent } = await processor.process({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "ban",
        group_id: 111111,
        operator_id: 10001,
        user_id: 10002,
        duration: 600,
      });
      expect(groupBanEvent).toBeNull();
    });

    it("名解析失败：名字退化为 null，事件仍产生", async () => {
      const failing = { request: vi.fn().mockRejectedValue(new Error("member info down")) };
      const processor = makeProcessor(failing);
      const { groupBanEvent } = await processor.process({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "ban",
        group_id: 987654,
        operator_id: 10001,
        user_id: 10002,
        duration: 600,
      });
      expect(groupBanEvent).toMatchObject({
        targetName: null,
        operatorName: null,
        durationSeconds: 600,
      });
    });

    it('duration 为数字字符串 "600"：string-tolerant 解析为 600（不静默降级 0）', async () => {
      const processor = makeProcessor(nameRequester());
      const { groupBanEvent } = await processor.process({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "ban",
        group_id: 987654,
        operator_id: 10001,
        user_id: 10002,
        duration: "600",
      });
      expect(groupBanEvent).toMatchObject({ subType: "ban", durationSeconds: 600 });
    });

    it("operator_id=0（系统/匿名操作者）：operatorUserId 归 null（渲染退化「管理员」）", async () => {
      const processor = makeProcessor(nameRequester());
      const { groupBanEvent } = await processor.process({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "ban",
        group_id: 987654,
        operator_id: 0,
        user_id: 10002,
        duration: 600,
      });
      expect(groupBanEvent).toMatchObject({ operatorUserId: null, operatorName: null });
    });

    it("duration 畸形：降级为 0，事件仍保留", async () => {
      const processor = makeProcessor(nameRequester());
      const { groupBanEvent } = await processor.process({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "ban",
        group_id: 987654,
        operator_id: 10001,
        user_id: 10002,
        duration: "oops",
      });
      expect(groupBanEvent).toMatchObject({ subType: "ban", durationSeconds: 0 });
    });

    it("非 group_ban 的 notice：不产生 groupBanEvent", async () => {
      const processor = makeProcessor(nameRequester());
      const { groupBanEvent } = await processor.process({
        post_type: "notice",
        notice_type: "group_recall",
        group_id: 987654,
        operator_id: 10001,
        user_id: 10002,
      });
      expect(groupBanEvent).toBeNull();
    });
  });
});
