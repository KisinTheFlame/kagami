import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NapcatEventPersistenceWriter } from "../../src/service/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatGatewayService } from "../../src/service/napcat-gateway.impl.service.js";
import {
  FakeWebSocket,
  createAgentEventQueue,
  createConfigManager,
  createNapcatEventDao,
  createNapcatGroupMessageDao,
  createNapcatGroupMessageChunkDao,
  initTestLogger,
  waitOneTick,
} from "./napcat-gateway.test-helper.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
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
      eventQueue: createAgentEventQueue(),
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    await gateway.start();
    const socket = sockets[0];
    socket.emitOpen();

    const sendPromise = gateway.sendGroupMessage({
      groupId: "987654",
      message: "hello group",
    });
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as { echo: string };

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

  it("should publish listened group message events and persist them", async () => {
    const sockets: FakeWebSocket[] = [];
    const eventQueue = createAgentEventQueue();
    const napcatGroupMessageDao = createNapcatGroupMessageDao();
    const persistenceWriter = new NapcatEventPersistenceWriter({
      napcatGroupMessageDao,
      napcatGroupMessageChunkDao: createNapcatGroupMessageChunkDao(),
    });
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      eventQueue,
      persistenceWriter,
      imageMessageAnalyzer,
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    await gateway.start();
    const socket = sockets[0];
    socket.emitOpen();

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
      expect.objectContaining({
        type: "napcat_group_message",
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
      eventQueue: createAgentEventQueue(),
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer,
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    await gateway.start();
    const socket = sockets[0];
    socket.emitOpen();

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

  it("should not persist action response messages", async () => {
    const sockets: FakeWebSocket[] = [];
    const napcatEventDao = createNapcatEventDao();
    const gateway = await DefaultNapcatGatewayService.create({
      configManager: createConfigManager(),
      eventQueue: createAgentEventQueue(),
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

    await gateway.start();
    const socket = sockets[0];
    socket.emitOpen();

    const sendPromise = gateway.sendGroupMessage({
      groupId: "987654",
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
      eventQueue,
      persistenceWriter: new NapcatEventPersistenceWriter({}),
      imageMessageAnalyzer: orderedImageAnalyzer,
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    await gateway.start();
    const socket = sockets[0];
    socket.emitOpen();

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
      expect.objectContaining({
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
      expect.objectContaining({
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
});
