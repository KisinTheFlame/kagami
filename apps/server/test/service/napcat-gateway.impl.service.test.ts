import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NapcatEventPersistenceWriter } from "../../src/napcat/service/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatGatewayService } from "../../src/napcat/service/napcat-gateway.impl.service.js";
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
    analyzeImageSegment: vi.fn().mockResolvedValue("[图片: 屏幕截图，包含错误提示]"),
  };

  beforeEach(() => {
    logs = initTestLogger();
    imageMessageAnalyzer.analyzeImageSegment.mockClear();
    imageMessageAnalyzer.analyzeImageSegment.mockResolvedValue("[图片: 屏幕截图，包含错误提示]");
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

  it("should resolve sendPrivateMessage when NapCat returns success response", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
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
    const firstImageAnalysis = createDeferred<string>();
    const orderedImageAnalyzer = {
      analyzeImageSegment: vi.fn().mockImplementation(() => firstImageAnalysis.promise),
    };
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: eventQueue.enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer: orderedImageAnalyzer,
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

    firstImageAnalysis.resolve("[图片: 第一张图]");
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

  it("should reject getGroupInfo when groupId is empty", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      enqueueGroupMessageEvent: createAgentEventQueue().enqueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
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
});
