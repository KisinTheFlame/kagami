import { describe, expect, it, vi } from "vitest";
import { QqApp } from "../../../../src/agent/apps/qq/qq.app.js";
import { NotificationCenter } from "../../../../src/agent/runtime/root-agent/notification/notification-center.js";
import type { NotificationScheduler } from "../../../../src/agent/runtime/root-agent/notification/notification-scheduler.js";
import type { ToolComponent } from "@kagami/agent-runtime";
import type {
  NapcatGatewayService,
  NapcatGroupMessageData,
} from "../../../../src/napcat/service/napcat-gateway.service.js";
import type { NapcatReceiveMessageSegment } from "../../../../src/napcat/service/napcat-gateway/shared.js";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";

initTestLoggerRuntime();

class FakeScheduler implements NotificationScheduler {
  private fn: (() => void) | null = null;
  public scheduleInterval(_intervalMs: number, fn: () => void): () => void {
    this.fn = fn;
    return () => {
      this.fn = null;
    };
  }
  public tick(): void {
    this.fn?.();
  }
}

function fakeGateway(overrides: Partial<NapcatGatewayService> = {}): NapcatGatewayService {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    sendGroupMessage: vi.fn(),
    sendPrivateMessage: vi.fn(),
    getFriendList: vi.fn().mockResolvedValue([]),
    getGroupInfo: vi.fn().mockResolvedValue({
      groupId: "1",
      groupName: "产品群",
      memberCount: 1,
      maxMemberCount: 2,
      groupRemark: "",
      groupAllShut: false,
    }),
    getRecentGroupMessages: vi.fn().mockResolvedValue([]),
    getRecentPrivateMessages: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as NapcatGatewayService;
}

const dummySendTool = { name: "send_message" } as unknown as ToolComponent;

function groupMessage(text: string, atQQ?: string): NapcatGroupMessageData {
  const segments: NapcatReceiveMessageSegment[] = [
    { type: "text", data: { text } } as NapcatReceiveMessageSegment,
  ];
  if (atQQ) {
    segments.unshift({ type: "at", data: { qq: atQQ } } as NapcatReceiveMessageSegment);
  }
  return {
    groupId: "1",
    userId: "654321",
    nickname: "群友",
    rawMessage: text,
    messageSegments: segments,
    messageId: 1,
    time: 1,
  };
}

function createApp(scheduler: FakeScheduler, onFlush: (lines: string[]) => void) {
  const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });
  return new QqApp({
    napcatGateway: fakeGateway(),
    notificationCenter: center,
    botQQ: "10001",
    listenGroupIds: ["1"],
    recentMessageLimit: 5,
    sendMessageTool: dummySendTool,
  });
}

describe("QqApp", () => {
  it("loads group display names on startup", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    const content = (await app.onFocus())[0];
    expect(content.type).toBe("append_message");
    expect("content" in content ? content.content : "").toContain("产品群");
  });

  it("pushes a chat notification on an incoming group message", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const app = createApp(scheduler, onFlush);
    await app.onStartup();

    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("在吗") });
    scheduler.tick();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "产品群: 在吗"]);
  });

  it("marks [有人@你] when the bot is mentioned", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const app = createApp(scheduler, onFlush);
    await app.onStartup();

    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("看下", "10001") });
    scheduler.tick();

    expect(onFlush.mock.calls[0][0][1]).toContain("[有人 @ 你]");
  });

  it("open_conversation sets the current chat target and clears that source", async () => {
    const scheduler = new FakeScheduler();
    const center = new NotificationCenter({ windowMs: 100, onFlush: vi.fn(), scheduler });
    const clearSpy = vi.spyOn(center, "clearForSource");
    const app = new QqApp({
      napcatGateway: fakeGateway(),
      notificationCenter: center,
      botQQ: "10001",
      listenGroupIds: ["1"],
      recentMessageLimit: 5,
      sendMessageTool: dummySendTool,
    });
    await app.onStartup();

    expect(app.getCurrentChatTarget()).toBeUndefined();
    const result = await app.openConversation("qq_group:1");
    expect(result.ok).toBe(true);
    expect(app.getCurrentChatTarget()).toEqual({ chatType: "group", groupId: "1" });
    expect(clearSpy).toHaveBeenCalledWith("qq_group:1");
  });

  it("creates a private conversation from a friend list update", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    app.handleNapcatEvent({
      type: "napcat_friend_list_updated",
      data: { friends: [{ userId: "888", nickname: "老王", remark: null }] },
    });
    const result = await app.openConversation("qq_private:888");
    expect(result.ok).toBe(true);
    expect(app.getCurrentChatTarget()).toEqual({ chatType: "private", userId: "888" });
  });

  it("back_to_conversation_list clears the current conversation", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    await app.openConversation("qq_group:1");
    expect(app.getCurrentChatTarget()).toBeDefined();
    app.backToConversationList();
    expect(app.getCurrentChatTarget()).toBeUndefined();
  });

  it("ingests a private message: creates the conversation and pushes a notification", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const app = createApp(scheduler, onFlush);
    await app.onStartup();

    app.handleNapcatEvent({
      type: "napcat_private_message",
      data: {
        userId: "888",
        nickname: "老王",
        remark: null,
        rawMessage: "在不在",
        messageSegments: [{ type: "text", data: { text: "在不在" } } as never],
        messageId: 1,
        time: 1,
      },
    });
    scheduler.tick();

    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "老王: 在不在"]);
    // 会话被建出来，能打开
    expect((await app.openConversation("qq_private:888")).ok).toBe(true);
    expect(app.getCurrentChatTarget()).toEqual({ chatType: "private", userId: "888" });
  });

  it("open_conversation renders recent messages fetched from the gateway", async () => {
    const app = new QqApp({
      napcatGateway: fakeGateway({
        getRecentGroupMessages: vi.fn().mockResolvedValue([groupMessage("历史一条")]),
      }),
      notificationCenter: new NotificationCenter({
        windowMs: 100,
        onFlush: vi.fn(),
        scheduler: new FakeScheduler(),
      }),
      botQQ: "10001",
      listenGroupIds: ["1"],
      recentMessageLimit: 5,
      sendMessageTool: dummySendTool,
    });
    await app.onStartup();

    const result = await app.openConversation("qq_group:1");
    expect(result.ok).toBe(true);
    expect(result.content).toContain("历史一条");
    expect(result.content).toContain("<qq_conversation");
  });

  it("rejects opening an unknown conversation", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    const result = await app.openConversation("qq_group:does-not-exist");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("CONVERSATION_NOT_FOUND");
  });
});
