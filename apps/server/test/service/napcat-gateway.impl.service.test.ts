import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NapcatEventDao } from "../../src/dao/napcat-event.dao.js";
import type { NapcatGroupMessageDao } from "../../src/dao/napcat-group-message.dao.js";
import type { LogEvent, LogSink } from "../../src/logger/types.js";
import { initLoggerRuntime } from "../../src/logger/runtime.js";
import { DefaultNapcatGatewayService } from "../../src/service/napcat-gateway.impl.service.js";

class FakeWebSocket {
  public readyState = 0;
  public readonly sentPayloads: string[] = [];

  private readonly listeners: Record<string, Array<(event?: unknown) => void>> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  public send(data: string): void {
    this.sentPayloads.push(data);
  }

  public close(): void {
    this.readyState = 3;
    this.emit("close", { code: 1000, reason: "closed" });
  }

  public addEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners[type]?.push(listener);
  }

  public emitOpen(): void {
    this.readyState = 1;
    this.emit("open");
  }

  public emitMessage(data: unknown): void {
    this.emit("message", { data });
  }

  private emit(type: string, event?: unknown): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }
}

describe("DefaultNapcatGatewayService", () => {
  let logs: LogEvent[] = [];

  beforeEach(() => {
    logs = [];
    const sink: LogSink = {
      write(event) {
        logs.push(event);
      },
    };
    initLoggerRuntime({ sinks: [sink] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve sendGroupMessage when NapCat returns success response", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
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
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      action: string;
      params: {
        group_id: string;
        message: Array<{
          type: string;
          data: Record<string, unknown>;
        }>;
      };
      echo: string;
    };

    expect(sentPayload.action).toBe("send_group_msg");
    expect(sentPayload.params.group_id).toBe("987654");
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
        stream: "normal-action",
      }),
    );

    await expect(sendPromise).resolves.toEqual({ messageId: 9528 });
    await gateway.stop();
  });

  it("should reject when NapCat returns retcode error", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
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
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      echo: string;
    };

    socket.emitMessage(
      JSON.stringify({
        status: "failed",
        retcode: 1400,
        data: null,
        message: "请求参数错误",
        echo: sentPayload.echo,
        stream: "normal-action",
      }),
    );

    await expect(sendPromise).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    await gateway.stop();
  });

  it("should reject timed out request and ignore stale response", async () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 1000,
      listenGroupId: "987654",
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
    const sentPayload = JSON.parse(socket.sentPayloads[0]) as {
      echo: string;
    };

    const rejectionAssertion = expect(sendPromise).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(1001);
    await rejectionAssertion;

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: { message_id: 1 },
        message: "",
        echo: sentPayload.echo,
        stream: "normal-action",
      }),
    );

    await gateway.stop();
  });

  it("should log private message events from NapCat", async () => {
    const sockets: FakeWebSocket[] = [];
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
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

    const matchedLog = logs.find(
      log => log.metadata.event === "napcat.gateway.private_message_received",
    );
    expect(matchedLog).toBeDefined();
    expect(matchedLog?.metadata.userId).toBe("123456");
    expect(matchedLog?.metadata.messageId).toBe(9988);
    expect(matchedLog?.metadata.rawMessage).toBe("hi");
    expect(matchedLog?.metadata.time).toBe(1710000000);
    expect(matchedLog?.metadata.subType).toBe("friend");

    await gateway.stop();
  });

  it("should publish listened group message events", async () => {
    const sockets: FakeWebSocket[] = [];
    const onGroupMessage = vi.fn();
    const napcatGroupMessageDao = createNapcatGroupMessageDao();
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
      onGroupMessage,
      napcatGroupMessageDao,
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
          nickname: "测试昵称",
        },
      }),
    );
    const lookupPayload = JSON.parse(socket.sentPayloads[0]) as {
      action: string;
      params: {
        group_id: string;
        user_id: string;
        no_cache: boolean;
      };
      echo: string;
    };

    expect(lookupPayload.action).toBe("get_group_member_info");
    expect(lookupPayload.params).toEqual({
      group_id: "987654",
      user_id: "10001",
      no_cache: false,
    });

    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          card: "测试成员",
          nickname: "备用昵称",
        },
        message: "",
        echo: lookupPayload.echo,
        stream: "normal-action",
      }),
    );
    await waitOneTick();

    expect(onGroupMessage).toHaveBeenCalledWith({
      groupId: "987654",
      userId: "123456",
      nickname: "测试群名片",
      rawMessage: "{@测试成员(10001)} hello group",
      messageId: 9988,
      time: 1710000000,
      payload: expect.objectContaining({
        post_type: "message",
        message_type: "group",
      }),
    });
    expect(napcatGroupMessageDao.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "987654",
        userId: "123456",
        nickname: "测试群名片",
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
        eventTime: new Date(1710000000 * 1000),
      }),
    );

    await gateway.stop();
  });

  it("should reuse cached group member display name within ttl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z"));

    const sockets: FakeWebSocket[] = [];
    const onGroupMessage = vi.fn();
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
      onGroupMessage,
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
          nickname: "测试昵称",
        },
      }),
    );

    const firstLookupPayload = JSON.parse(socket.sentPayloads[0]) as { echo: string };
    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          card: "缓存昵称",
        },
        message: "",
        echo: firstLookupPayload.echo,
        stream: "normal-action",
      }),
    );
    await flushMicrotasks();
    expect(onGroupMessage).toHaveBeenCalledTimes(1);

    socket.emitMessage(
      JSON.stringify({
        post_type: "message",
        message_type: "group",
        group_id: "987654",
        user_id: 123456,
        self_id: 654321,
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
        time: 1710000001,
        sender: {
          card: "测试群名片",
          nickname: "测试昵称",
        },
      }),
    );
    await flushMicrotasks();

    expect(socket.sentPayloads).toHaveLength(1);
    expect(onGroupMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        rawMessage: "{@缓存昵称(10001)} again",
      }),
    );

    await gateway.stop();
  });

  it("should refresh cached group member display name after ttl expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z"));

    const sockets: FakeWebSocket[] = [];
    const onGroupMessage = vi.fn();
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
      onGroupMessage,
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
          nickname: "测试昵称",
        },
      }),
    );

    const firstLookupPayload = JSON.parse(socket.sentPayloads[0]) as { echo: string };
    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          card: "旧昵称",
        },
        message: "",
        echo: firstLookupPayload.echo,
        stream: "normal-action",
      }),
    );
    await flushMicrotasks();
    expect(onGroupMessage).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-03-10T00:10:00.001Z"));

    socket.emitMessage(
      JSON.stringify({
        post_type: "message",
        message_type: "group",
        group_id: "987654",
        user_id: 123456,
        self_id: 654321,
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
        time: 1710000001,
        sender: {
          card: "测试群名片",
          nickname: "测试昵称",
        },
      }),
    );

    expect(socket.sentPayloads).toHaveLength(2);

    const secondLookupPayload = JSON.parse(socket.sentPayloads[1]) as { echo: string };
    socket.emitMessage(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          card: "新昵称",
        },
        message: "",
        echo: secondLookupPayload.echo,
        stream: "normal-action",
      }),
    );
    await flushMicrotasks();

    expect(onGroupMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        rawMessage: "{@新昵称(10001)} again",
      }),
    );

    await gateway.stop();
  });

  it("should ignore non-listened group message events", async () => {
    const sockets: FakeWebSocket[] = [];
    const onGroupMessage = vi.fn();
    const napcatGroupMessageDao = createNapcatGroupMessageDao();
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
      onGroupMessage,
      napcatGroupMessageDao,
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
        group_id: "10086",
        user_id: 123456,
        self_id: 654321,
        message_id: 9988,
        raw_message: "hello group",
        time: 1710000000,
      }),
    );

    expect(onGroupMessage).not.toHaveBeenCalled();
    await waitOneTick();
    expect(napcatGroupMessageDao.insert).not.toHaveBeenCalled();

    await gateway.stop();
  });

  it("should ignore bot self group message events", async () => {
    const sockets: FakeWebSocket[] = [];
    const onGroupMessage = vi.fn();
    const napcatGroupMessageDao = createNapcatGroupMessageDao();
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
      onGroupMessage,
      napcatGroupMessageDao,
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
        self_id: 123456,
        message_id: 9988,
        raw_message: "hello group",
        time: 1710000000,
      }),
    );

    expect(onGroupMessage).not.toHaveBeenCalled();
    await waitOneTick();
    expect(napcatGroupMessageDao.insert).not.toHaveBeenCalled();

    await gateway.stop();
  });

  it("should persist empty message segments when payload.message is missing", async () => {
    const sockets: FakeWebSocket[] = [];
    const onGroupMessage = vi.fn();
    const napcatGroupMessageDao = createNapcatGroupMessageDao();
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
      onGroupMessage,
      napcatGroupMessageDao,
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
        raw_message: "hello group",
        time: 1710000000,
        sender: {
          card: "测试群名片",
          nickname: "测试昵称",
        },
      }),
    );

    await waitOneTick();
    expect(onGroupMessage).toHaveBeenCalledTimes(1);
    expect(napcatGroupMessageDao.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "987654",
        message: [],
      }),
    );

    await gateway.stop();
  });

  it("should ignore listened group message without raw_message when persisting group message", async () => {
    const sockets: FakeWebSocket[] = [];
    const onGroupMessage = vi.fn();
    const napcatGroupMessageDao = createNapcatGroupMessageDao();
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
      onGroupMessage,
      napcatGroupMessageDao,
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
        time: 1710000000,
      }),
    );

    expect(onGroupMessage).not.toHaveBeenCalled();
    await waitOneTick();
    expect(napcatGroupMessageDao.insert).not.toHaveBeenCalled();

    await gateway.stop();
  });

  it("should persist post_type events into dao", async () => {
    const sockets: FakeWebSocket[] = [];
    const napcatEventDao = createNapcatEventDao();
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
      napcatEventDao,
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

    expect(napcatEventDao.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        postType: "message",
        messageType: "private",
        subType: "friend",
        userId: "123456",
        groupId: null,
        rawMessage: "hi",
        eventTime: new Date(1710000000 * 1000),
      }),
    );

    await gateway.stop();
  });

  it("should not persist blocked post_type events", async () => {
    const sockets: FakeWebSocket[] = [];
    const napcatEventDao = createNapcatEventDao();
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
      napcatEventDao,
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
        post_type: "meta_event",
        meta_event_type: "heartbeat",
        self_id: 714457117,
        time: 1710000000,
      }),
    );
    await waitOneTick();

    expect(napcatEventDao.insert).not.toHaveBeenCalled();

    await gateway.stop();
  });

  it("should not persist action response message", async () => {
    const sockets: FakeWebSocket[] = [];
    const napcatEventDao = createNapcatEventDao();
    const gateway = new DefaultNapcatGatewayService({
      wsUrl: "ws://napcat:3001/",
      reconnectMs: 3000,
      requestTimeoutMs: 10000,
      listenGroupId: "987654",
      napcatEventDao,
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
});

function createNapcatEventDao(): NapcatEventDao & {
  insert: ReturnType<typeof vi.fn>;
} {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    countByQuery: vi.fn().mockResolvedValue(0),
    listByQueryPage: vi.fn().mockResolvedValue([]),
  };
}

function createNapcatGroupMessageDao(): NapcatGroupMessageDao & {
  insert: ReturnType<typeof vi.fn>;
} {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    countByQuery: vi.fn().mockResolvedValue(0),
    listByQueryPage: vi.fn().mockResolvedValue([]),
  };
}

async function waitOneTick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function flushMicrotasks(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  }
}
