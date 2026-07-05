import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NapcatEventPersistenceWriter } from "../src/application/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatGatewayService } from "../src/application/napcat-gateway.impl.service.js";
import {
  FakeWebSocket,
  createAgentEventQueue,
  createConfigManager,
  createNapcatEventDao,
  createNapcatGroupMessageDao,
  initTestLogger,
  waitOneTick,
} from "./napcat-gateway.test-helper.js";

function expectEnqueuedGroupMessage(data: Record<string, unknown>) {
  return expect.objectContaining({
    type: "napcat_group_message",
    data: expect.objectContaining(data),
  });
}

function expectEnqueuedFriendListUpdated(friends: Array<Record<string, unknown>>) {
  return expect.objectContaining({
    type: "napcat_friend_list_updated",
    data: {
      friends,
    },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function emitActionResponse(socket: FakeWebSocket, payloadIndex: number, data: unknown): void {
  const sentPayload = JSON.parse(socket.sentPayloads[payloadIndex]) as {
    echo: string;
  };

  socket.emitMessage(
    JSON.stringify({
      status: "ok",
      retcode: 0,
      data,
      message: "",
      echo: sentPayload.echo,
    }),
  );
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("DefaultNapcatGatewayService", () => {
  let logs = initTestLogger();
  const imageMessageAnalyzer = {
    analyzeImageSegment: vi
      .fn()
      .mockResolvedValue({ description: "屏幕截图，包含错误提示", resid: null }),
  };

  beforeEach(() => {
    logs = initTestLogger();
    imageMessageAnalyzer.analyzeImageSegment.mockClear();
    imageMessageAnalyzer.analyzeImageSegment.mockResolvedValue({
      description: "屏幕截图，包含错误提示",
      resid: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve sendGroupMessage when NapCat returns success response", async () => {
    const sockets: FakeWebSocket[] = [];
    const configManager = createConfigManager();
    const gateway = await DefaultNapcatGatewayService.create({
      configManager,
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const sendPromise = gateway.sendGroupMessage({
      groupId: "123456",
      message: "hello group",
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      echo: string;
      params: {
        group_id: string;
        message: unknown;
      };
    };

    expect(sentPayload.params.group_id).toBe("123456");
    expect(sentPayload.params.message).toEqual([
      {
        type: "text",
        data: {
          text: "hello group",
        },
      },
    ]);

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          message_id: 9528,
        },
        message: "",
        echo: sentPayload.echo,
      }),
    );

    await expect(sendPromise).resolves.toEqual({ messageId: 9528 });
    await gateway.stop();
  });

  it("should send mention segments parsed from outgoing message text", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const sendPromise = gateway.sendGroupMessage({
      groupId: "123456",
      message: "{@闻震(870853294)} hi",
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      echo: string;
      params: {
        group_id: string;
        message: unknown;
      };
    };

    expect(sentPayload.params.group_id).toBe("123456");
    expect(sentPayload.params.message).toEqual([
      {
        type: "at",
        data: {
          qq: "870853294",
        },
      },
      {
        type: "text",
        data: {
          text: " hi",
        },
      },
    ]);

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          message_id: 9529,
        },
        message: "",
        echo: sentPayload.echo,
      }),
    );

    await expect(sendPromise).resolves.toEqual({ messageId: 9529 });
    await gateway.stop();
  });

  it("should prepend a reply segment when sendGroupMessage carries a reply target", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const sendPromise = gateway.sendGroupMessage({
      groupId: "123456",
      message: "收到",
      replyToMessageId: 9988,
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      echo: string;
      params: {
        group_id: string;
        message: unknown;
      };
    };

    expect(sentPayload.params.group_id).toBe("123456");
    expect(sentPayload.params.message).toEqual([
      {
        type: "reply",
        data: {
          id: "9988",
        },
      },
      {
        type: "text",
        data: {
          text: "收到",
        },
      },
    ]);

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          message_id: 9531,
        },
        message: "",
        echo: sentPayload.echo,
      }),
    );

    await expect(sendPromise).resolves.toEqual({ messageId: 9531 });
    await gateway.stop();
  });

  it("should resolve sendPrivateMessage when NapCat returns success response", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const sendPromise = gateway.sendPrivateMessage({
      userId: "123456",
      message: "hello friend",
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      echo: string;
      params: {
        user_id: string;
        message: unknown;
      };
    };

    expect(sentPayload.params.user_id).toBe("123456");
    expect(sentPayload.params.message).toEqual([
      {
        type: "text",
        data: {
          text: "hello friend",
        },
      },
    ]);

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          message_id: 9630,
        },
        message: "",
        echo: sentPayload.echo,
      }),
    );

    await expect(sendPromise).resolves.toEqual({ messageId: 9630 });
    await gateway.stop();
  });

  it("should refresh cached friend list every 10 seconds", async () => {
    vi.useFakeTimers();

    const sockets: FakeWebSocket[] = [];
    const eventQueue = createAgentEventQueue();
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: eventQueue.enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const getFriendListPromise = gateway.getFriendList();
    emitActionResponse(socket, 0, [
      {
        user_id: 123456,
        nickname: "初始好友",
        remark: null,
      },
    ]);
    await flushMicrotasks();
    await expect(getFriendListPromise).resolves.toEqual([
      {
        userId: "123456",
        nickname: "初始好友",
        remark: null,
      },
    ]);
    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      1,
      expectEnqueuedFriendListUpdated([
        {
          userId: "123456",
          nickname: "初始好友",
          remark: null,
        },
      ]),
    );

    await vi.advanceTimersByTimeAsync(10_000);

    expect(socket.sentPayloads).toHaveLength(2);
    emitActionResponse(socket, 1, [
      {
        user_id: 123456,
        nickname: "初始好友",
        remark: null,
      },
      {
        user_id: 234567,
        nickname: "新增好友",
        remark: "新备注",
      },
    ]);
    await flushMicrotasks();

    await expect(gateway.getFriendList()).resolves.toEqual([
      {
        userId: "123456",
        nickname: "初始好友",
        remark: null,
      },
      {
        userId: "234567",
        nickname: "新增好友",
        remark: "新备注",
      },
    ]);
    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      2,
      expectEnqueuedFriendListUpdated([
        {
          userId: "123456",
          nickname: "初始好友",
          remark: null,
        },
        {
          userId: "234567",
          nickname: "新增好友",
          remark: "新备注",
        },
      ]),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.sentPayloads).toHaveLength(3);
    emitActionResponse(socket, 2, [
      {
        user_id: 123456,
        nickname: "初始好友",
        remark: "更新后的备注",
      },
      {
        user_id: 234567,
        nickname: "新增好友",
        remark: "新备注",
      },
    ]);
    await flushMicrotasks();
    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      3,
      expectEnqueuedFriendListUpdated([
        {
          userId: "123456",
          nickname: "初始好友",
          remark: "更新后的备注",
        },
        {
          userId: "234567",
          nickname: "新增好友",
          remark: "新备注",
        },
      ]),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.sentPayloads).toHaveLength(4);
    emitActionResponse(socket, 3, [
      {
        user_id: 123456,
        nickname: "初始好友",
        remark: "更新后的备注",
      },
      {
        user_id: 234567,
        nickname: "新增好友",
        remark: "新备注",
      },
    ]);
    await flushMicrotasks();
    expect(eventQueue.enqueue).toHaveBeenCalledTimes(3);

    await gateway.stop();
  });

  it("should publish listened group message events and persist them", async () => {
    const sockets: FakeWebSocket[] = [];
    const eventQueue = createAgentEventQueue();
    const napcatGroupMessageDao = createNapcatGroupMessageDao();
    const persistenceWriter = new NapcatEventPersistenceWriter({
      napcatQqMessageDao: napcatGroupMessageDao,
    });
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: eventQueue.enqueue,
      persistenceWriter,
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    socket.emitMessage(
      JSON.stringify({
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
        },
      }),
    );
    const lookupPayload = JSON.parse(socket.sentPayloads[0]) as { echo: string };

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          card: "测试成员",
        },
        message: "",
        echo: lookupPayload.echo,
      }),
    );
    await waitOneTick();

    expect(eventQueue.enqueue).toHaveBeenCalledWith(
      expectEnqueuedGroupMessage({
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
    expect(napcatGroupMessageDao.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "group",
        subType: "normal",
        groupId: "987654",
        messageId: 9988,
      }),
    );

    await gateway.stop();
  });

  it("should log private message events from NapCat", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    socket.emitMessage(
      JSON.stringify({
        post_type: "message",
        message_type: "private",
        user_id: 123456,
        message_id: 9988,
        raw_message: "hi",
        time: 1710000000,
        sub_type: "friend",
      }),
    );
    await waitOneTick();

    expect(logs.some(log => log.metadata.event === "napcat.gateway.private_message_received")).toBe(
      true,
    );
    await gateway.stop();
  });

  it("should enqueue private message events from NapCat when sender is in friend list", async () => {
    const sockets: FakeWebSocket[] = [];
    const eventQueue = createAgentEventQueue();
    const napcatGroupMessageDao = createNapcatGroupMessageDao();
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: eventQueue.enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({
        napcatQqMessageDao: napcatGroupMessageDao,
      }),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    socket.emitMessage(
      JSON.stringify({
        post_type: "message",
        message_type: "private",
        sub_type: "friend",
        user_id: 123456,
        self_id: 654321,
        message_id: 9988,
        raw_message: "hi",
        message: [
          {
            type: "text",
            data: {
              text: "hi",
            },
          },
        ],
        time: 1710000000,
        sender: {
          nickname: "测试好友",
        },
      }),
    );
    await waitOneTick();
    emitActionResponse(socket, 0, [
      {
        user_id: 123456,
        nickname: "测试好友",
        remark: "好友备注",
      },
    ]);
    await waitOneTick();
    await waitOneTick();

    expect(eventQueue.enqueue).toHaveBeenCalledWith(
      expectEnqueuedFriendListUpdated([
        {
          userId: "123456",
          nickname: "测试好友",
          remark: "好友备注",
        },
      ]),
    );
    expect(eventQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "napcat_private_message",
        data: expect.objectContaining({
          userId: "123456",
          nickname: "测试好友",
          remark: "好友备注",
          rawMessage: "hi",
          messageId: 9988,
        }),
      }),
    );
    expect(napcatGroupMessageDao.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "private",
        subType: "friend",
        groupId: null,
        userId: "123456",
        nickname: "测试好友",
        messageId: 9988,
      }),
    );

    await gateway.stop();
  });

  it("should persist private message events without enqueuing agent event for non-friends", async () => {
    const sockets: FakeWebSocket[] = [];
    const eventQueue = createAgentEventQueue();
    const napcatGroupMessageDao = createNapcatGroupMessageDao();
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: eventQueue.enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({
        napcatQqMessageDao: napcatGroupMessageDao,
      }),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    socket.emitMessage(
      JSON.stringify({
        post_type: "message",
        message_type: "private",
        sub_type: "friend",
        user_id: 123456,
        self_id: 654321,
        message_id: 9988,
        raw_message: "hi",
        message: [
          {
            type: "text",
            data: {
              text: "hi",
            },
          },
        ],
        time: 1710000000,
        sender: {
          nickname: "测试好友",
        },
      }),
    );
    await waitOneTick();
    emitActionResponse(socket, 0, []);
    await waitOneTick();
    await waitOneTick();
    await waitOneTick();

    expect(eventQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(eventQueue.enqueue).toHaveBeenCalledWith(expectEnqueuedFriendListUpdated([]));
    expect(eventQueue.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "napcat_private_message",
      }),
    );
    await vi.waitFor(() => {
      expect(napcatGroupMessageDao.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          messageType: "private",
          userId: "123456",
          nickname: "测试好友",
        }),
      );
    });

    await gateway.stop();
  });

  it("should not persist action response messages", async () => {
    const sockets: FakeWebSocket[] = [];
    const napcatEventDao = createNapcatEventDao();
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({
        napcatEventDao,
      }),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const sendPromise = gateway.sendGroupMessage({
      groupId: "123456",
      message: "hello",
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as { echo: string };

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          message_id: 9527,
        },
        message: "",
        echo: sentPayload.echo,
      }),
    );
    await sendPromise;
    await waitOneTick();

    expect(napcatEventDao.insert).not.toHaveBeenCalled();
    await gateway.stop();
  });

  it("should preserve incoming event order while image analysis runs concurrently", async () => {
    const sockets: FakeWebSocket[] = [];
    const eventQueue = createAgentEventQueue();
    const firstImageAnalysis = createDeferred<{ description: string; resid: string | null }>();
    const orderedImageAnalyzer = {
      analyzeImageSegment: vi.fn().mockImplementation(() => firstImageAnalysis.promise),
    };
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: eventQueue.enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer: orderedImageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    socket.emitMessage(
      JSON.stringify({
        post_type: "message",
        message_type: "group",
        group_id: "987654",
        user_id: 123456,
        self_id: 654321,
        message_id: 1001,
        raw_message: "[CQ:image,file=a.png,url=https://example.com/a.png]",
        message: [
          {
            type: "image",
            data: {
              summary: "图片",
              file: "a.png",
              sub_type: 0,
              url: "https://example.com/a.png",
              file_size: "100",
            },
          },
        ],
        sender: {
          card: "测试群名片",
        },
      }),
    );

    socket.emitMessage(
      JSON.stringify({
        post_type: "message",
        message_type: "group",
        group_id: "987654",
        user_id: 123456,
        self_id: 654321,
        message_id: 1002,
        raw_message: "later",
        message: [
          {
            type: "text",
            data: {
              text: "later",
            },
          },
        ],
        sender: {
          card: "测试群名片",
        },
      }),
    );

    await waitOneTick();
    expect(eventQueue.enqueue).not.toHaveBeenCalled();

    firstImageAnalysis.resolve({ description: "第一张图", resid: null });
    await waitOneTick();

    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      1,
      expectEnqueuedGroupMessage({
        messageId: 1001,
        rawMessage: "[图片: 第一张图]",
        messageSegments: [
          {
            type: "image",
            data: {
              summary: "第一张图",
              file: "a.png",
              sub_type: 0,
              url: "https://example.com/a.png",
              file_size: "100",
            },
          },
        ],
      }),
    );
    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      2,
      expectEnqueuedGroupMessage({
        messageId: 1002,
        rawMessage: "later",
        messageSegments: [
          {
            type: "text",
            data: {
              text: "later",
            },
          },
        ],
      }),
    );

    await gateway.stop();
  });

  it("should fetch recent group messages and normalize them into data payloads", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const historyPromise = gateway.getRecentGroupMessages({
      groupId: "987654",
      count: 2,
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      echo: string;
      action: string;
      params: Record<string, unknown>;
    };

    expect(sentPayload.action).toBe("get_group_msg_history");
    expect(sentPayload.params).toEqual({
      group_id: "987654",
      message_seq: 0,
      count: 2,
    });

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          messages: [
            {
              post_type: "message_sent",
              message_type: "group",
              message_sent_type: "self",
              group_id: "987654",
              user_id: 654321,
              self_id: 654321,
              message_id: 1002,
              raw_message: "bot reply",
              message: [
                {
                  type: "text",
                  data: {
                    text: "bot reply",
                  },
                },
              ],
              time: 1710000001,
              sender: {
                card: "Kagami",
              },
            },
            {
              group_id: "987654",
              user_id: 123456,
              self_id: 654321,
              message_id: 1001,
              raw_message: "[CQ:at,qq=10001] hello",
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
                    text: " hello",
                  },
                },
              ],
              time: 1710000000,
              sender: {
                card: "测试群名片",
              },
            },
          ],
        },
        message: "",
        echo: sentPayload.echo,
      }),
    );
    await waitOneTick();
    const lookupPayload = JSON.parse(socket.sentPayloads[1]) as { echo: string };
    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          card: "测试成员",
        },
        message: "",
        echo: lookupPayload.echo,
      }),
    );

    await expect(historyPromise).resolves.toEqual([
      {
        groupId: "987654",
        userId: "123456",
        nickname: "测试群名片",
        rawMessage: "{@测试成员(10001)} hello",
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
              text: " hello",
            },
          },
        ],
        messageId: 1001,
        time: 1710000000,
      },
      {
        groupId: "987654",
        userId: "654321",
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
        messageId: 1002,
        time: 1710000001,
      },
    ]);

    await gateway.stop();
  });

  it("should fetch recent private messages and normalize them into qq payloads", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const historyPromise = gateway.getRecentPrivateMessages({
      userId: "123456",
      count: 2,
      messageSeq: 99,
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      echo: string;
      action: string;
      params: Record<string, unknown>;
    };

    expect(sentPayload.action).toBe("get_friend_msg_history");
    expect(sentPayload.params).toEqual({
      user_id: "123456",
      count: 2,
      message_seq: 99,
    });

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          messages: [
            {
              post_type: "message_sent",
              message_type: "private",
              sub_type: "friend",
              user_id: 123456,
              self_id: 654321,
              message_id: 1002,
              raw_message: "bot reply",
              message: [
                {
                  type: "text",
                  data: {
                    text: "bot reply",
                  },
                },
              ],
              time: 1710000001,
              sender: {
                nickname: "Kagami",
              },
            },
            {
              user_id: 123456,
              self_id: 654321,
              message_id: 1001,
              raw_message: "hello",
              message: [
                {
                  type: "text",
                  data: {
                    text: "hello",
                  },
                },
              ],
              time: 1710000000,
              sender: {
                nickname: "测试好友",
              },
            },
          ],
        },
        message: "",
        echo: sentPayload.echo,
      }),
    );

    await expect(historyPromise).resolves.toEqual([
      expect.objectContaining({
        messageType: "private",
        subType: "friend",
        groupId: null,
        userId: "123456",
        nickname: "测试好友",
        messageId: 1001,
        rawMessage: "hello",
      }),
      expect.objectContaining({
        messageType: "private",
        subType: "friend",
        groupId: null,
        userId: "123456",
        nickname: "Kagami",
        messageId: 1002,
        rawMessage: "bot reply",
      }),
    ]);

    await gateway.stop();
  });

  it("should fetch group info and normalize it into project shape", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const groupInfoPromise = gateway.getGroupInfo({
      groupId: "987654",
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      echo: string;
      action: string;
      params: Record<string, unknown>;
    };

    expect(sentPayload.action).toBe("get_group_info");
    expect(sentPayload.params).toEqual({
      group_id: "987654",
    });

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          group_all_shut: 1,
          group_remark: "",
          group_id: 987654,
          group_name: "测试群",
          member_count: 42,
          max_member_count: 200,
        },
        message: "",
        echo: sentPayload.echo,
      }),
    );

    await expect(groupInfoPromise).resolves.toEqual({
      groupId: "987654",
      groupName: "测试群",
      memberCount: 42,
      maxMemberCount: 200,
      groupRemark: "",
      groupAllShut: true,
    });

    await gateway.stop();
  });

  it("should fetch a forward page via get_msg inline content and paginate from cache", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const firstPagePromise = gateway.getForwardMessages({ id: "res-1", offset: 0, limit: 2 });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      echo: string;
      action: string;
      params: Record<string, unknown>;
    };

    // 主路径先发 get_msg（容器消息），转发段自带内联 content。
    expect(sentPayload.action).toBe("get_msg");
    expect(sentPayload.params).toEqual({ message_id: "res-1" });

    emitActionResponse(socket, 0, {
      message: [
        {
          type: "forward",
          data: {
            id: "res-1",
            content: [
              {
                user_id: 10001,
                time: 1,
                message: [{ type: "text", data: { text: "甲说的话" } }],
                sender: { nickname: "甲" },
              },
              {
                user_id: 10002,
                time: 2,
                message: [{ type: "text", data: { text: "乙说的话" } }],
                sender: { nickname: "乙" },
              },
              {
                user_id: 10003,
                time: 3,
                message: [{ type: "text", data: { text: "丙说的话" } }],
                sender: { nickname: "丙" },
              },
            ],
          },
        },
      ],
    });

    await expect(firstPagePromise).resolves.toEqual({
      total: 3,
      offset: 0,
      nodes: [
        { senderName: "甲", senderUserId: "10001", rawMessage: "甲说的话", time: 1 },
        { senderName: "乙", senderUserId: "10002", rawMessage: "乙说的话", time: 2 },
      ],
    });

    // 第二页：命中原始节点缓存，不再发新请求。
    await expect(gateway.getForwardMessages({ id: "res-1", offset: 2, limit: 2 })).resolves.toEqual(
      {
        total: 3,
        offset: 2,
        nodes: [{ senderName: "丙", senderUserId: "10003", rawMessage: "丙说的话", time: 3 }],
      },
    );
    expect(socket.sentPayloads).toHaveLength(1);

    await gateway.stop();
  });

  it("should fall back to get_forward_msg when get_msg carries no forward content", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const pagePromise = gateway.getForwardMessages({ id: "res-2", offset: 0, limit: 50 });

    // 第一发 get_msg，但容器里没有 forward 段（无内联 content）。
    const first = JSON.parse(socket.sentPayloads[0]) as { action: string };
    expect(first.action).toBe("get_msg");
    emitActionResponse(socket, 0, { message: [{ type: "text", data: { text: "不是转发" } }] });
    await flushMicrotasks();

    // 回退到 get_forward_msg。
    const second = JSON.parse(socket.sentPayloads[1]) as { action: string; params: unknown };
    expect(second.action).toBe("get_forward_msg");
    expect(second.params).toEqual({ message_id: "res-2" });
    emitActionResponse(socket, 1, {
      messages: [
        {
          user_id: 20001,
          time: 5,
          message: [{ type: "text", data: { text: "兜底拿到的" } }],
          sender: { nickname: "丁" },
        },
      ],
    });

    await expect(pagePromise).resolves.toEqual({
      total: 1,
      offset: 0,
      nodes: [{ senderName: "丁", senderUserId: "20001", rawMessage: "兜底拿到的", time: 5 }],
    });
    expect(socket.sentPayloads).toHaveLength(2);

    await gateway.stop();
  });

  it("should retry on transient empty and not cache the empty result", async () => {
    vi.useFakeTimers();

    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    // 每轮尝试都先 get_msg（空）再 get_forward_msg（空）；穷尽 3 次后返回 total 0。
    const answerEmptyRound = async (getMsgIndex: number): Promise<void> => {
      await flushMicrotasks();
      emitActionResponse(socket, getMsgIndex, { message: [] });
      await flushMicrotasks();
      emitActionResponse(socket, getMsgIndex + 1, { messages: [] });
      await flushMicrotasks();
    };

    const firstPromise = gateway.getForwardMessages({ id: "res-empty", offset: 0, limit: 50 });
    await answerEmptyRound(0); // 尝试 1
    await vi.advanceTimersByTimeAsync(400); // 退避 1
    await answerEmptyRound(2); // 尝试 2
    await vi.advanceTimersByTimeAsync(800); // 退避 2
    await answerEmptyRound(4); // 尝试 3
    await expect(firstPromise).resolves.toEqual({ total: 0, offset: 0, nodes: [] });
    expect(socket.sentPayloads).toHaveLength(6); // 3 轮 × 2 请求

    // 空结果没缓存：第二次调用会重新发请求，这次 get_msg 拿到内容。
    const secondPromise = gateway.getForwardMessages({ id: "res-empty", offset: 0, limit: 50 });
    await flushMicrotasks();
    emitActionResponse(socket, 6, {
      message: [
        {
          type: "forward",
          data: {
            id: "res-empty",
            content: [
              {
                user_id: 30001,
                time: 9,
                message: [{ type: "text", data: { text: "稍后就有了" } }],
                sender: { nickname: "戊" },
              },
            ],
          },
        },
      ],
    });
    await expect(secondPromise).resolves.toEqual({
      total: 1,
      offset: 0,
      nodes: [{ senderName: "戊", senderUserId: "30001", rawMessage: "稍后就有了", time: 9 }],
    });
    expect(socket.sentPayloads).toHaveLength(7); // 第二次确实重新发了请求

    await gateway.stop();
  });

  it("should reject getForwardMessages when NapCat returns an invalid structure", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const forwardPromise = gateway.getForwardMessages({ id: "res-9", offset: 0, limit: 50 });
    // get_msg 拿不到内联 content（回退），再由 get_forward_msg 的非法结构触发拒绝。
    emitActionResponse(socket, 0, { message: [{ type: "text", data: { text: "x" } }] });
    await flushMicrotasks();
    emitActionResponse(socket, 1, { messages: "not-an-array" });

    await expect(forwardPromise).rejects.toMatchObject({
      meta: {
        reason: "INVALID_FORWARD_MESSAGE_RESPONSE",
      },
    });

    await gateway.stop();
  });

  it("should reject getGroupInfo when groupId is empty", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    await expect(
      gateway.getGroupInfo({
        groupId: "",
      }),
    ).rejects.toMatchObject({
      message: "groupId 必须是非空字符串",
      meta: {
        reason: "INVALID_GROUP_ID",
      },
    });
    expect(socket.sentPayloads).toHaveLength(0);

    await gateway.stop();
  });

  it("should reject getGroupInfo when NapCat group info response is invalid", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const groupInfoPromise = gateway.getGroupInfo({
      groupId: "987654",
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as { echo: string };

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          group_all_shut: 0,
          group_remark: "",
          group_id: 987654,
          member_count: 42,
          max_member_count: 200,
        },
        message: "",
        echo: sentPayload.echo,
      }),
    );

    await expect(groupInfoPromise).rejects.toMatchObject({
      message: "NapCat 返回的群信息结构无效",
      meta: {
        reason: "INVALID_GROUP_INFO_RESPONSE",
      },
    });

    await gateway.stop();
  });

  it("getGroupMemberShutUp: 未来时间戳→毫秒；0/过去→null；畸形响应→null", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    const futureSec = Math.floor(Date.now() / 1000) + 3600;
    const p1 = gateway.getGroupMemberShutUp({ groupId: "987654", userId: "10001" });
    emitActionResponse(socket, 0, { shut_up_timestamp: futureSec });
    await expect(p1).resolves.toBe(futureSec * 1000);
    // no_cache=true 走实时值。
    expect(JSON.parse(socket.sentPayloads[0]).params).toMatchObject({
      group_id: "987654",
      user_id: "10001",
      no_cache: true,
    });

    const p2 = gateway.getGroupMemberShutUp({ groupId: "987654", userId: "10001" });
    emitActionResponse(socket, 1, { shut_up_timestamp: 0 });
    await expect(p2).resolves.toBeNull();

    const p3 = gateway.getGroupMemberShutUp({ groupId: "987654", userId: "10001" });
    emitActionResponse(socket, 2, { unrelated: true });
    await expect(p3).resolves.toBeNull();

    // 数字字符串（NapCat 某些版本发字符串）→ 解析为毫秒。
    const futureSecStr = String(Math.floor(Date.now() / 1000) + 7200);
    const p4 = gateway.getGroupMemberShutUp({ groupId: "987654", userId: "10001" });
    emitActionResponse(socket, 3, { shut_up_timestamp: futureSecStr });
    await expect(p4).resolves.toBe(Number(futureSecStr) * 1000);

    // 非数字字符串 → NaN → null。
    const p5 = gateway.getGroupMemberShutUp({ groupId: "987654", userId: "10001" });
    emitActionResponse(socket, 4, { shut_up_timestamp: "oops" });
    await expect(p5).resolves.toBeNull();

    await gateway.stop();
  });

  it("ordered：group_ban notice 夹在两条群消息之间，保持相对发布顺序", async () => {
    const sockets: FakeWebSocket[] = [];
    const eventQueue = createAgentEventQueue();
    const firstImageAnalysis = createDeferred<{ description: string; resid: string | null }>();
    const orderedImageAnalyzer = {
      analyzeImageSegment: vi.fn().mockImplementation(() => firstImageAnalysis.promise),
    };
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: eventQueue.enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer: orderedImageAnalyzer,
      qqMessageDao: createNapcatGroupMessageDao(),
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const startPromise = gateway.start();
    const socket = sockets[0];
    socket.emitOpen();
    await startPromise;

    // seq0：带图群消息（analysis 挂起，卡住 flush）。
    socket.emitMessage(
      JSON.stringify({
        post_type: "message",
        message_type: "group",
        group_id: "987654",
        user_id: 123456,
        self_id: 654321,
        message_id: 2001,
        raw_message: "[CQ:image,file=a.png,url=https://example.com/a.png]",
        message: [
          {
            type: "image",
            data: {
              summary: "图片",
              file: "a.png",
              sub_type: 0,
              url: "https://example.com/a.png",
              file_size: "100",
            },
          },
        ],
        sender: { card: "测试群名片" },
      }),
    );
    // seq1：禁言 notice。
    socket.emitMessage(
      JSON.stringify({
        post_type: "notice",
        notice_type: "group_ban",
        sub_type: "ban",
        group_id: 987654,
        operator_id: 10001,
        user_id: 10002,
        duration: 600,
        self_id: 654321,
        time: 1783000000,
      }),
    );

    // 禁言事件的 operator/target 名解析发出 get_group_member_info 请求（target 先、operator 后）。
    await waitOneTick();
    emitActionResponse(socket, 0, { card: "李四" });
    emitActionResponse(socket, 1, { card: "张三" });
    await waitOneTick();

    // seq0 的图仍挂起：ban 已处理完但被 flush 顺序卡住，什么都没发布。
    expect(eventQueue.enqueue).not.toHaveBeenCalled();

    firstImageAnalysis.resolve({ description: "第一张图", resid: null });
    await waitOneTick();

    // 顺序：先群消息（seq0），再禁言事件（seq1）。
    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      1,
      expectEnqueuedGroupMessage({ messageId: 2001 }),
    );
    expect(eventQueue.enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "napcat_group_ban",
        data: expect.objectContaining({
          groupId: "987654",
          subType: "ban",
          targetUserId: "10002",
          targetName: "李四",
          operatorName: "张三",
          durationSeconds: 600,
        }),
      }),
    );

    await gateway.stop();
  });
});
