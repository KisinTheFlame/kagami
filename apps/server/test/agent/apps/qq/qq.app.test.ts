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
  public schedule(_delayMs: number, fn: () => void): () => void {
    this.fn = fn;
    return () => {
      this.fn = null;
    };
  }
  /** 模拟当前节流窗口到点。 */
  public fireWindowEnd(): void {
    const fn = this.fn;
    this.fn = null;
    fn?.();
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
    getForwardMessages: vi.fn().mockResolvedValue({ nodes: [], total: 0, offset: 0 }),
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

  it("owns the napcat gateway lifecycle: start on startup, stop on shutdown", async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    const app = new QqApp({
      napcatGateway: fakeGateway({ start, stop }),
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
    expect(start).toHaveBeenCalledTimes(1);

    await app.onShutdown();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("pushes a chat notification on an incoming group message", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const app = createApp(scheduler, onFlush);
    await app.onStartup();

    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("在吗") });

    expect(onFlush).toHaveBeenCalledTimes(1);
    // 群通知行带发送者：`{群名}: {发送者}：{内容}`。
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "产品群: 群友：在吗"]);
  });

  it("keeps the unread count climbing across windows, resetting only on open", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const app = createApp(scheduler, onFlush);
    await app.onStartup();

    // 空闲第一条→立即直达，count 1（无条数标签）。
    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("1") });
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "产品群: 群友：1"]);

    // 再来一条→窗内攒着，窗结束 flush，count 2。
    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("2") });
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[1][0]).toEqual(["QQ:", "产品群: [2 条消息]群友：2"]);

    // 又一条→没有 open，计数继续涨到 3，而不是按窗口重新计数。
    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("3") });
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[2][0]).toEqual(["QQ:", "产品群: [3 条消息]群友：3"]);

    // 小镜终于来看→未读清零；窗口排空回到空闲。
    await app.openConversation("qq_group:1");
    scheduler.fireWindowEnd();

    // 之后的新消息从 count 1 重新开始。
    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("4") });
    expect(onFlush.mock.calls[3][0]).toEqual(["QQ:", "产品群: 群友：4"]);
  });

  it("marks [有人@你] when the bot is mentioned", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const app = createApp(scheduler, onFlush);
    await app.onStartup();

    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("看下", "10001") });

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

  it("persists the unread badge: exportState → restoreState round-trips count + mention", async () => {
    const source = createApp(new FakeScheduler(), vi.fn());
    await source.onStartup();
    // 群里堆 2 条、其中一条 @ 了小镜；私聊来 1 条。
    source.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("一") });
    source.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("二", "10001") });
    source.handleNapcatEvent({
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

    const snapshot = source.exportState();

    // 新实例（模拟重启）恢复存档。
    const restored = createApp(new FakeScheduler(), vi.fn());
    restored.restoreState(snapshot);
    await restored.onStartup();

    // 群会话未读红点（2 条 + @）跨"重启"保留。
    const groupList = (await restored.onFocus())[0];
    const groupText = "content" in groupList ? groupList.content : "";
    expect(groupText).toContain("产品群");
    expect(groupText).toContain("未读 2");

    // 私聊会话也被恢复出来、带未读，可打开。
    expect((await restored.openConversation("qq_private:888")).ok).toBe(true);
  });

  it("restoreState ignores an unrecognized shape instead of throwing", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    expect(() => app.restoreState({ version: 999, junk: true })).not.toThrow();
    expect(() => app.restoreState("garbage")).not.toThrow();
    await app.onStartup();
    const list = (await app.onFocus())[0];
    expect("content" in list ? list.content : "").not.toContain("未读");
  });

  it("rejects opening an unknown conversation", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    const result = await app.openConversation("qq_group:does-not-exist");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("CONVERSATION_NOT_FOUND");
  });

  it("view_forward renders a forward page wrapped in <qq_forward> with a pagination hint", async () => {
    const getForwardMessages = vi.fn().mockResolvedValue({
      nodes: [
        { senderName: "小明", senderUserId: "10001", rawMessage: "上午开会", time: 1 },
        { senderName: "小红", senderUserId: "10002", rawMessage: "[图片: 一张架构图]", time: 2 },
      ],
      total: 60,
      offset: 0,
    });
    const app = new QqApp({
      napcatGateway: fakeGateway({ getForwardMessages }),
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

    const result = await app.viewForward("res-123", 0);
    expect(result.ok).toBe(true);
    expect(getForwardMessages).toHaveBeenCalledWith({ id: "res-123", offset: 0, limit: 50 });
    expect(result.content).toContain('<qq_forward id="res-123">');
    expect(result.content).toContain("小明 (10001): 上午开会");
    expect(result.content).toContain("小红 (10002): [图片: 一张架构图]");
    // 共 60 条只显示了前 2 条，应给出继续翻页的提示（从第 2 条之后起）。
    expect(result.content).toContain("还有 58 条");
    expect(result.content).toContain("offset=2");
  });

  it("view_forward reports an error when the gateway fails", async () => {
    const app = new QqApp({
      napcatGateway: fakeGateway({
        getForwardMessages: vi.fn().mockRejectedValue(new Error("boom")),
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

    const result = await app.viewForward("res-404", 0);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});
