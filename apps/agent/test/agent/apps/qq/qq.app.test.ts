import { describe, expect, it, vi } from "vitest";
import { QqApp } from "../../../../src/agent/apps/qq/qq.app.js";
import { GroupMuteStateStore } from "../../../../src/agent/capabilities/messaging/application/group-mute-state.store.js";
import { NotificationCenter } from "../../../../src/agent/runtime/root-agent/notification/notification-center.js";
import type { NotificationScheduler } from "../../../../src/agent/runtime/root-agent/notification/notification-scheduler.js";
import type { ToolComponent } from "@kagami/agent-runtime";
import type {
  NapcatGatewayService,
  NapcatGroupBanData,
  NapcatGroupMessageData,
} from "../../../../src/napcat/application/napcat-gateway.service.js";
import type { NapcatReceiveMessageSegment } from "../../../../src/napcat/application/napcat-gateway/shared.js";
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

function createApp(
  scheduler: FakeScheduler,
  onFlush: (lines: string[]) => void,
  options: {
    notifyForegroundInput?: () => void;
    napcatGateway?: NapcatGatewayService;
    muteStore?: GroupMuteStateStore;
  } = {},
) {
  const center = new NotificationCenter({ leadingWindowMs: 50, windowMs: 100, onFlush, scheduler });
  return new QqApp({
    napcatGateway: options.napcatGateway ?? fakeGateway(),
    notificationCenter: center,
    notifyForegroundInput: options.notifyForegroundInput ?? (() => {}),
    botQQ: "10001",
    creatorName: "测试创造者",
    creatorQQ: "20002",
    listenGroupIds: ["1"],
    recentMessageLimit: 5,
    muteStore: options.muteStore ?? new GroupMuteStateStore(),
    sendMessageTool: dummySendTool,
    sendResourceTool: dummySendTool,
    listGroupFilesTool: dummySendTool,
    downloadGroupFileTool: dummySendTool,
    uploadGroupFileTool: dummySendTool,
  });
}

describe("QqApp", () => {
  it("discloses QQ scene, chat behavior and its own QQ number via help", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    const help = await app.help();

    // 平台知识 + 消息格式下沉到这里
    expect(help).toContain("## QQ 和 QQ 群");
    expect(help).toContain("<qq_message>");
    // 前台实时输入（issue #251）：新标签说明 + 「不回 = wait」机制句 + 通知计数快照语义
    expect(help).toContain("<qq_conversation_new_messages>");
    expect(help).toContain("不想回就直接 wait");
    expect(help).toContain("通知里的未读计数是发出时刻的快照");
    // 旧语义的错话（当前会话也走通知）必须已移除
    expect(help).not.toContain("新消息会以通知形式提醒你（不在这个 App 里也会）");
    // 群聊行为整块从主 system prompt 迁到 QQ App
    expect(help).toContain("<attention_and_reply>");
    expect(help).toContain("<anti_ai_tone>");
    // 工具清单仍在
    expect(help).toContain("open_conversation(id)");
    // 小镜自己的 QQ 号从 identity 迁到这里
    expect(help).toContain("10001");
    // 创造者的 QQ 号也在 QQ 语境里能看到
    expect(help).toContain("测试创造者");
    expect(help).toContain("20002");
  });

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
        leadingWindowMs: 50,
        windowMs: 100,
        onFlush: vi.fn(),
        scheduler: new FakeScheduler(),
      }),
      notifyForegroundInput: () => {},
      botQQ: "10001",
      creatorName: "测试创造者",
      creatorQQ: "20002",
      listenGroupIds: ["1"],
      recentMessageLimit: 5,
      muteStore: new GroupMuteStateStore(),
      sendMessageTool: dummySendTool,
      sendResourceTool: dummySendTool,
      listGroupFilesTool: dummySendTool,
      downloadGroupFileTool: dummySendTool,
      uploadGroupFileTool: dummySendTool,
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
    scheduler.fireWindowEnd(); // 空闲来第一条→前沿短窗结束才 flush

    expect(onFlush).toHaveBeenCalledTimes(1);
    // 通知带最新一条预览：群聊附发言人 + 正文。
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "产品群: 群友: 在吗"]);
  });

  it("keeps the unread count climbing across windows, resetting only on open", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const app = createApp(scheduler, onFlush);
    await app.onStartup();

    // 空闲第一条→开前沿短窗，窗结束 flush，count 1（无条数标签，只带预览）。
    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("1") });
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "产品群: 群友: 1"]);

    // 再来一条→窗内攒着，窗结束 flush，count 2，预览取最新一条。
    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("2") });
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[1][0]).toEqual(["QQ:", "产品群: [2 条消息] 群友: 2"]);

    // 又一条→没有 open，计数继续涨到 3，而不是按窗口重新计数。
    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("3") });
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[2][0]).toEqual(["QQ:", "产品群: [3 条消息] 群友: 3"]);

    // 小镜终于来看→未读清零；窗口排空回到空闲。open 成功后会话成为前台当前
    // （focused 自愈），先 blur 让后续消息回到通知路径。
    await app.openConversation("qq_group:1");
    scheduler.fireWindowEnd();
    await app.onBlur();

    // 之后的新消息从 count 1 重新开始（又走前沿短窗）。
    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("4") });
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[3][0]).toEqual(["QQ:", "产品群: 群友: 4"]);
  });

  it("marks [有人@你] when the bot is mentioned", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const app = createApp(scheduler, onFlush);
    await app.onStartup();

    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("看下", "10001") });
    scheduler.fireWindowEnd(); // 空闲来第一条→前沿短窗结束才 flush

    expect(onFlush.mock.calls[0][0][1]).toContain("[有人 @ 你]");
  });

  it("open_conversation sets the current chat target and clears that source", async () => {
    const scheduler = new FakeScheduler();
    const center = new NotificationCenter({
      leadingWindowMs: 50,
      windowMs: 100,
      onFlush: vi.fn(),
      scheduler,
    });
    const clearSpy = vi.spyOn(center, "clearForSource");
    const app = new QqApp({
      napcatGateway: fakeGateway(),
      notificationCenter: center,
      notifyForegroundInput: () => {},
      botQQ: "10001",
      creatorName: "测试创造者",
      creatorQQ: "20002",
      listenGroupIds: ["1"],
      recentMessageLimit: 5,
      muteStore: new GroupMuteStateStore(),
      sendMessageTool: dummySendTool,
      sendResourceTool: dummySendTool,
      listGroupFilesTool: dummySendTool,
      downloadGroupFileTool: dummySendTool,
      uploadGroupFileTool: dummySendTool,
    });
    await app.onStartup();
    await app.onFocus(); // 进入 QQ（前台）才会对外暴露发送目标

    expect(app.getCurrentChatTarget()).toBeUndefined();
    const result = await app.openConversation("qq_group:1");
    expect(result.ok).toBe(true);
    expect(app.getCurrentChatTarget()).toEqual({ chatType: "group", groupId: "1" });
    expect(clearSpy).toHaveBeenCalledWith("qq_group:1");
  });

  it("creates a private conversation from a friend list update", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    await app.onFocus();
    app.handleNapcatEvent({
      type: "napcat_friend_list_updated",
      data: { friends: [{ userId: "888", nickname: "老王", remark: null }] },
    });
    const result = await app.openConversation("qq_private:888");
    expect(result.ok).toBe(true);
    expect(app.getCurrentChatTarget()).toEqual({ chatType: "private", userId: "888" });
  });

  it("gates the chat target on being in the foreground: blur hides it, focus restores it", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    await app.onFocus();
    await app.openConversation("qq_group:1");
    // 前台 + 有当前会话 → 暴露发送目标。
    expect(app.getCurrentChatTarget()).toEqual({ chatType: "group", groupId: "1" });

    // 退到后台：当前会话焦点保留，但不再对外暴露发送目标（防泄漏到 QQ 之外）。
    await app.onBlur();
    expect(app.getCurrentChatTarget()).toBeUndefined();

    // 回到 QQ：焦点续上原会话，发送目标重新可用。
    await app.onFocus();
    expect(app.getCurrentChatTarget()).toEqual({ chatType: "group", groupId: "1" });
  });

  it("returns no chat target when focused but no conversation is open", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    await app.onFocus();
    expect(app.getCurrentChatTarget()).toBeUndefined();
  });

  it("list_conversations is a pure read: lists conversations, marks current, leaves focus unchanged", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    await app.onFocus();
    await app.openConversation("qq_group:1");

    const listed = app.listConversations();
    expect(listed).toContain("<qq_conversation_list>");
    expect(listed).toContain("产品群");
    expect(listed).toContain("← 当前会话"); // 标注当前焦点
    // 纯读：当前会话 / 发送目标不变。
    expect(app.getCurrentChatTarget()).toEqual({ chatType: "group", groupId: "1" });
  });

  it("onFocus keeps the current conversation and replays messages received while backgrounded", async () => {
    const scheduler = new FakeScheduler();
    const center = new NotificationCenter({
      leadingWindowMs: 50,
      windowMs: 100,
      onFlush: vi.fn(),
      scheduler,
    });
    const clearSpy = vi.spyOn(center, "clearForSource");
    const app = new QqApp({
      napcatGateway: fakeGateway(),
      notificationCenter: center,
      notifyForegroundInput: () => {},
      botQQ: "10001",
      creatorName: "测试创造者",
      creatorQQ: "20002",
      listenGroupIds: ["1"],
      recentMessageLimit: 5,
      muteStore: new GroupMuteStateStore(),
      sendMessageTool: dummySendTool,
      sendResourceTool: dummySendTool,
      listGroupFilesTool: dummySendTool,
      downloadGroupFileTool: dummySendTool,
      uploadGroupFileTool: dummySendTool,
    });
    await app.onStartup();
    await app.onFocus();
    await app.openConversation("qq_group:1"); // 进过一次，之后取未读尾补档

    // 退到后台，期间来两条消息（攒成未读）。
    await app.onBlur();
    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("后台消息一") });
    app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage("后台消息二") });
    clearSpy.mockClear();

    // 回到 QQ：列表 + 当前会话补档（后台两条），未读清零、该源通知清掉。
    const effect = (await app.onFocus())[0];
    const content = "content" in effect ? effect.content : "";
    expect(content).toContain("<qq_conversation_list>");
    expect(content).toContain("← 当前会话");
    expect(content).toContain("后台消息一");
    expect(content).toContain("后台消息二");
    expect(clearSpy).toHaveBeenCalledWith("qq_group:1");
    // 未读已清零：列表里当前会话不再带未读标。
    expect(content).not.toContain("未读 2");
  });

  it("onFocus tells you the current conversation had no new messages while away", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    await app.onFocus();
    await app.openConversation("qq_group:1");
    await app.onBlur();

    const effect = (await app.onFocus())[0];
    const content = "content" in effect ? effect.content : "";
    expect(content).toContain("当前会话期间无新消息");
  });

  it("onFocus with no open conversation renders only the list, no replay block", async () => {
    const app = createApp(new FakeScheduler(), vi.fn());
    await app.onStartup();
    const effect = (await app.onFocus())[0];
    const content = "content" in effect ? effect.content : "";
    expect(content).toContain("<qq_conversation_list>");
    expect(content).not.toContain("<qq_conversation "); // 没有会话补档块
  });

  it("onFocus replay shows the recent tail and flags older unread beyond the buffer", async () => {
    const app = new QqApp({
      napcatGateway: fakeGateway(),
      notificationCenter: new NotificationCenter({
        leadingWindowMs: 50,
        windowMs: 100,
        onFlush: vi.fn(),
        scheduler: new FakeScheduler(),
      }),
      notifyForegroundInput: () => {},
      botQQ: "10001",
      creatorName: "测试创造者",
      creatorQQ: "20002",
      listenGroupIds: ["1"],
      recentMessageLimit: 2, // 缓冲只留 2 条，未读计数不封顶
      muteStore: new GroupMuteStateStore(),
      sendMessageTool: dummySendTool,
      sendResourceTool: dummySendTool,
      listGroupFilesTool: dummySendTool,
      downloadGroupFileTool: dummySendTool,
      uploadGroupFileTool: dummySendTool,
    });
    await app.onStartup();
    await app.onFocus();
    await app.openConversation("qq_group:1");
    await app.onBlur();

    // 后台来 5 条：缓冲只留最近 2，未读计数 5。
    for (const n of ["1", "2", "3", "4", "5"]) {
      app.handleNapcatEvent({ type: "napcat_group_message", data: groupMessage(`m${n}`) });
    }

    const effect = (await app.onFocus())[0];
    const content = "content" in effect ? effect.content : "";
    expect(content).toContain("m4");
    expect(content).toContain("m5");
    expect(content).not.toContain("m1");
    expect(content).toContain("更早 3 条未读未展示"); // 5 - 2

    // 未读清零：再退再回，不再有补档内容。
    await app.onBlur();
    const again = (await app.onFocus())[0];
    const againContent = "content" in again ? again.content : "";
    expect(againContent).toContain("当前会话期间无新消息");
  });

  it("ingests a private message: creates the conversation and pushes a notification", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const app = createApp(scheduler, onFlush);
    await app.onStartup();
    await app.onFocus();

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
    scheduler.fireWindowEnd(); // 空闲来第一条→前沿短窗结束才 flush

    // 私聊预览不重复标发送人（会话名就是对方），直接跟正文。
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
        leadingWindowMs: 50,
        windowMs: 100,
        onFlush: vi.fn(),
        scheduler: new FakeScheduler(),
      }),
      notifyForegroundInput: () => {},
      botQQ: "10001",
      creatorName: "测试创造者",
      creatorQQ: "20002",
      listenGroupIds: ["1"],
      recentMessageLimit: 5,
      muteStore: new GroupMuteStateStore(),
      sendMessageTool: dummySendTool,
      sendResourceTool: dummySendTool,
      listGroupFilesTool: dummySendTool,
      downloadGroupFileTool: dummySendTool,
      uploadGroupFileTool: dummySendTool,
    });
    await app.onStartup();

    const result = await app.openConversation("qq_group:1");
    expect(result.ok).toBe(true);
    expect(result.content).toContain("历史一条");
    expect(result.content).toContain("<qq_conversation");
    // message_id 作为「回复哪条」的句柄暴露在渲染里（groupMessage 默认 messageId=1）。
    expect(result.content).toContain('<qq_message id="1">');
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
        leadingWindowMs: 50,
        windowMs: 100,
        onFlush: vi.fn(),
        scheduler: new FakeScheduler(),
      }),
      notifyForegroundInput: () => {},
      botQQ: "10001",
      creatorName: "测试创造者",
      creatorQQ: "20002",
      listenGroupIds: ["1"],
      recentMessageLimit: 5,
      muteStore: new GroupMuteStateStore(),
      sendMessageTool: dummySendTool,
      sendResourceTool: dummySendTool,
      listGroupFilesTool: dummySendTool,
      downloadGroupFileTool: dummySendTool,
      uploadGroupFileTool: dummySendTool,
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
        leadingWindowMs: 50,
        windowMs: 100,
        onFlush: vi.fn(),
        scheduler: new FakeScheduler(),
      }),
      notifyForegroundInput: () => {},
      botQQ: "10001",
      creatorName: "测试创造者",
      creatorQQ: "20002",
      listenGroupIds: ["1"],
      recentMessageLimit: 5,
      muteStore: new GroupMuteStateStore(),
      sendMessageTool: dummySendTool,
      sendResourceTool: dummySendTool,
      listGroupFilesTool: dummySendTool,
      downloadGroupFileTool: dummySendTool,
      uploadGroupFileTool: dummySendTool,
    });

    const result = await app.viewForward("res-404", 0);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});

/** 可指定发送者与 messageId 的群消息（前台实时路径测试用）。 */
function fgMessage(
  text: string,
  { userId = "654321", messageId = 1 }: { userId?: string; messageId?: number | null } = {},
): NapcatGroupMessageData {
  return {
    groupId: "1",
    userId,
    nickname: "群友",
    rawMessage: text,
    messageSegments: [{ type: "text", data: { text } } as NapcatReceiveMessageSegment],
    messageId,
    time: 1,
  };
}

describe("QqApp 前台实时输入（issue #251）", () => {
  async function createFocusedApp(options: {
    onFlush?: (lines: string[]) => void;
    notifyForegroundInput?: () => void;
    napcatGateway?: NapcatGatewayService;
    scheduler?: FakeScheduler;
  }) {
    const app = createApp(options.scheduler ?? new FakeScheduler(), options.onFlush ?? vi.fn(), {
      notifyForegroundInput: options.notifyForegroundInput,
      napcatGateway: options.napcatGateway,
    });
    await app.onStartup();
    await app.onFocus(); // focused = true
    await app.openConversation("qq_group:1"); // current = qq_group:1（首进 fetch 返回 []）
    return app;
  }

  it("前台 + 当前会话：入缓冲 + 敲门，不推 center", async () => {
    const knock = vi.fn();
    const onFlush = vi.fn();
    const scheduler = new FakeScheduler();
    const app = await createFocusedApp({ onFlush, notifyForegroundInput: knock, scheduler });

    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("在吗", { messageId: 11 }),
    });

    expect(knock).toHaveBeenCalledTimes(1);
    scheduler.fireWindowEnd();
    expect(onFlush).not.toHaveBeenCalled(); // 实时路径不经 center
  });

  it("botQQ 回声：只入缓冲，不敲门、不推 center、不计未读", async () => {
    const knock = vi.fn();
    const onFlush = vi.fn();
    const scheduler = new FakeScheduler();
    const app = await createFocusedApp({ onFlush, notifyForegroundInput: knock, scheduler });

    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("我自己说的", { userId: "10001", messageId: 12 }),
    });

    expect(knock).not.toHaveBeenCalled();
    scheduler.fireWindowEnd();
    expect(onFlush).not.toHaveBeenCalled();
    // 回声不计未读 → 随后 blur 的退化补推也不产生 draft（回声不成通知）。
    await app.onBlur();
    scheduler.fireWindowEnd();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("QQ 后台或非当前会话的消息照旧走 center", async () => {
    const knock = vi.fn();
    const onFlush = vi.fn();
    const scheduler = new FakeScheduler();
    const app = await createFocusedApp({ onFlush, notifyForegroundInput: knock, scheduler });

    await app.onBlur(); // 退到后台
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("后台消息", { messageId: 13 }),
    });
    scheduler.fireWindowEnd();

    expect(knock).not.toHaveBeenCalled();
    expect(onFlush).toHaveBeenCalled();
  });

  it("drainForegroundInput：渲染增量并消费，二次 drain 拉空（幂等）", async () => {
    const app = await createFocusedApp({});
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("第一条", { messageId: 21 }),
    });
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("第二条", { messageId: 22 }),
    });

    const input = await app.drainForegroundInput();

    expect(input).not.toBeNull();
    expect(input?.itemCount).toBe(2);
    expect(input?.text).toContain('<qq_conversation_new_messages name="QQ 群 产品群 (1)">');
    expect(input?.text).toContain("第一条");
    expect(input?.text).toContain("第二条");
    expect(input?.text).toContain("</qq_conversation_new_messages>");
    // 实时投递过的不再出现：二次 drain 拉空。
    expect(await app.drainForegroundInput()).toBeNull();
    // 也不再出现在 onFocus 补档里（三路共用消费语义）。
    const replay = (await app.onFocus())[0];
    expect("content" in replay ? replay.content : "").not.toContain("第一条");
  });

  it("drainForegroundInput：缓冲溢出时带「更早 N 条未读未展示」提示行", async () => {
    const app = await createFocusedApp({});
    for (let i = 0; i < 8; i += 1) {
      // recentMessageLimit = 5，8 条溢出 3 条。
      app.handleNapcatEvent({
        type: "napcat_group_message",
        data: fgMessage(`第${i}条`, { messageId: 30 + i }),
      });
    }

    const input = await app.drainForegroundInput();

    expect(input?.itemCount).toBe(5);
    expect(input?.text).toContain("（更早 3 条未读未展示）");
  });

  it("drainForegroundInput：失焦自查返回 null（双重校验的 App 侧）", async () => {
    const app = await createFocusedApp({});
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("残留", { messageId: 41 }),
    });
    await app.onBlur();

    expect(await app.drainForegroundInput()).toBeNull();
  });

  it("onBlur 退化：未投递的未读补推 center draft", async () => {
    const onFlush = vi.fn();
    const scheduler = new FakeScheduler();
    const app = await createFocusedApp({ onFlush, scheduler });
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("没等到 drain", { messageId: 51 }),
    });

    await app.onBlur();
    scheduler.fireWindowEnd();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].join("\n")).toContain("产品群");
  });

  it("切会话退化：先对旧 current 补推 draft，再切换", async () => {
    const onFlush = vi.fn();
    const scheduler = new FakeScheduler();
    const app = await createFocusedApp({ onFlush, scheduler });
    // 让私聊会话存在（friend_list upsert）。
    app.handleNapcatEvent({
      type: "napcat_friend_list_updated",
      data: { friends: [{ userId: "888", nickname: "老王", remark: null }] },
    });
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("旧会话未读", { messageId: 61 }),
    });

    await app.openConversation("qq_private:888");
    scheduler.fireWindowEnd();

    // 旧 current（产品群）的未读出现在下一次 flush 里，不静默丢。
    expect(onFlush).toHaveBeenCalled();
    expect(onFlush.mock.calls[0][0].join("\n")).toContain("产品群");
  });

  it("fetch 窗口：await 期间到达且 fetch 未包含的消息保留，并敲门补投", async () => {
    const knock = vi.fn();
    let resolveFetch: (messages: NapcatGroupMessageData[]) => void = () => {};
    const gateway = fakeGateway({
      getRecentGroupMessages: vi.fn().mockImplementation(
        () =>
          new Promise<NapcatGroupMessageData[]>(resolve => {
            resolveFetch = resolve;
          }),
      ),
    });
    const app = createApp(new FakeScheduler(), vi.fn(), {
      notifyForegroundInput: knock,
      napcatGateway: gateway,
    });
    await app.onStartup();
    await app.onFocus();

    const opening = app.openConversation("qq_group:1"); // 首进：挂在 fetch 上
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("fetch 期间", { messageId: 71 }),
    });
    resolveFetch([]); // 历史里没有它
    await opening;

    expect(knock).toHaveBeenCalledTimes(1); // leftover 敲门补投
    const input = await app.drainForegroundInput();
    expect(input?.text).toContain("fetch 期间"); // 不丢
  });

  it("fetch 窗口：fetch 结果已包含的消息按 messageId 剔除，不重复", async () => {
    const knock = vi.fn();
    const arrived = fgMessage("重叠消息", { messageId: 81 });
    let resolveFetch: (messages: NapcatGroupMessageData[]) => void = () => {};
    const gateway = fakeGateway({
      getRecentGroupMessages: vi.fn().mockImplementation(
        () =>
          new Promise<NapcatGroupMessageData[]>(resolve => {
            resolveFetch = resolve;
          }),
      ),
    });
    const app = createApp(new FakeScheduler(), vi.fn(), {
      notifyForegroundInput: knock,
      napcatGateway: gateway,
    });
    await app.onStartup();
    await app.onFocus();

    const opening = app.openConversation("qq_group:1");
    app.handleNapcatEvent({ type: "napcat_group_message", data: arrived });
    resolveFetch([arrived]); // 历史已包含同 id 消息
    const opened = await opening;

    expect(opened.content).toContain("重叠消息"); // 经 fetch 展示一次
    expect(knock).not.toHaveBeenCalled(); // 无 leftover
    expect(await app.drainForegroundInput()).toBeNull(); // 不会二次注入
  });

  it("后台延迟回声也只入缓冲：不计未读、不推 center（回声防御全域生效）", async () => {
    const onFlush = vi.fn();
    const scheduler = new FakeScheduler();
    const app = await createFocusedApp({ onFlush, scheduler });
    await app.onBlur(); // 发完就切走，回声延迟到后台才回来

    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("延迟回声", { userId: "10001", messageId: 101 }),
    });
    scheduler.fireWindowEnd();

    expect(onFlush).not.toHaveBeenCalled(); // 自己的话绝不成通知（防自持振荡）
  });

  it("切会话窗口：fetch await 期间旧会话到达的消息被切换后的扫尾补推接住", async () => {
    const onFlush = vi.fn();
    const scheduler = new FakeScheduler();
    let resolveFetch: (messages: NapcatGroupMessageData[]) => void = () => {};
    const gateway = fakeGateway({
      getRecentPrivateMessages: vi.fn().mockImplementation(
        () =>
          new Promise<never[]>(resolve => {
            resolveFetch = resolve as (messages: NapcatGroupMessageData[]) => void;
          }),
      ),
    });
    const app = createApp(scheduler, onFlush, { napcatGateway: gateway });
    await app.onStartup();
    await app.onFocus();
    await app.openConversation("qq_group:1"); // current = 产品群
    app.handleNapcatEvent({
      type: "napcat_friend_list_updated",
      data: { friends: [{ userId: "888", nickname: "老王", remark: null }] },
    });

    const switching = app.openConversation("qq_private:888"); // 首开私聊：挂在 fetch 上
    // fetch 期间旧会话（仍是前台当前）来消息：走实时路径不进 center。
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("切换窗口", { messageId: 111 }),
    });
    resolveFetch([]);
    await switching;
    scheduler.fireWindowEnd();

    // 切换完成后 current 已是私聊，该消息永远 drain 不到——必须由扫尾补推接住。
    expect(onFlush).toHaveBeenCalled();
    expect(onFlush.mock.calls[0][0].join("\n")).toContain("产品群");
  });

  it("onBlur：补推抛错时 focused 仍已同步归位（第一行翻转的不变式）", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const app = await createFocusedApp({ onFlush, scheduler });
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("残留", { messageId: 121 }),
    });
    // 让退化补推炸掉：center push 抛错。
    const center = (app as unknown as { notificationCenter: { push: () => void } })
      .notificationCenter;
    vi.spyOn(center, "push").mockImplementation(() => {
      throw new Error("center 炸了");
    });

    await expect(app.onBlur()).rejects.toThrow("center 炸了");
    expect(app.getCurrentChatTarget()).toBeUndefined(); // focused 已翻 false
  });

  it("重启恢复的裸计数首开后不残留幻影红点（reconcile 对账）", async () => {
    const onFlush = vi.fn();
    const scheduler = new FakeScheduler();
    const app = createApp(scheduler, onFlush);
    await app.onStartup();
    // 模拟重启恢复：7 条未读裸计数（无缓冲内容）+ @ 标记。
    app.restoreState({
      version: 1,
      conversations: [{ id: "qq_group:1", unreadCount: 7, mentioned: true }],
    });
    await app.onFocus();

    await app.openConversation("qq_group:1"); // 首开：拉历史覆盖旧未读
    scheduler.fireWindowEnd();
    onFlush.mockClear();

    // 对账后无幻影：blur 不再对已被历史覆盖的旧计数反复补推假通知。
    await app.onBlur();
    scheduler.fireWindowEnd();
    expect(onFlush).not.toHaveBeenCalled();
    const list = (await app.onFocus())[0];
    expect("content" in list ? list.content : "").not.toContain("未读 7");
  });

  it("onFocus 半途抛错时 focused 保持 false（成功路径末尾才翻转）", async () => {
    const scheduler = new FakeScheduler();
    const knock = vi.fn();
    const onFlush = vi.fn();
    const app = await createFocusedApp({ onFlush, notifyForegroundInput: knock, scheduler });
    await app.onBlur();
    // 让 onFocus 的补档渲染炸掉（借 center 清理路径之外最近的可注入点：模板渲染依赖
    // displayName——这里直接 mock enterConversation 依赖面较深，改用私有态断言路径：
    // 用一个会抛错的 notificationCenter.clearForSource 模拟半途失败）。
    const center = (app as unknown as { notificationCenter: { clearForSource: () => void } })
      .notificationCenter;
    vi.spyOn(center, "clearForSource").mockImplementation(() => {
      throw new Error("onFocus 半途炸了");
    });

    await expect(app.onFocus()).rejects.toThrow("onFocus 半途炸了");

    // focused 仍为 false：后续消息走 center 通知路径（安全方向），不会静默滞留。
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("失败后消息", { messageId: 131 }),
    });
    expect(knock).not.toHaveBeenCalled();
    scheduler.fireWindowEnd();
    expect(onFlush).toHaveBeenCalled();
  });

  it("回声-only 缓冲 + stale 敲门：drain 返回 null，绝不把自己的发言注入成新消息（红队 P1）", async () => {
    const app = await createFocusedApp({});
    // 真实消息到达并被 open 补看消费（模拟同轮内重开会话），随后只剩自己的回声入缓冲。
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("真消息", { messageId: 141 }),
    });
    await app.openConversation("qq_group:1"); // 消费掉真消息（重开同会话）
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("我自己回的", { userId: "10001", messageId: 142 }),
    });

    // stale 敲门触发 drain：缓冲只剩回声（不计未读）→ 必须拉空。
    expect(await app.drainForegroundInput()).toBeNull();

    // 回声随下一次真实增量一起上屏。
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("别人又说话", { messageId: 143 }),
    });
    const input = await app.drainForegroundInput();
    expect(input?.text).toContain("我自己回的");
    expect(input?.text).toContain("别人又说话");
  });

  it("首开会话 fetch 返回空历史：缓冲内容直接展示，不被快照剔除吞掉（红队 P2）", async () => {
    const onFlush = vi.fn();
    const scheduler = new FakeScheduler();
    let resolveFetch: (messages: NapcatGroupMessageData[]) => void = () => {};
    const gateway = fakeGateway({
      getRecentGroupMessages: vi.fn().mockImplementation(
        () =>
          new Promise<NapcatGroupMessageData[]>(resolve => {
            resolveFetch = resolve;
          }),
      ),
    });
    const app = createApp(scheduler, onFlush, { napcatGateway: gateway });
    await app.onStartup();
    // 先攒 3 条未读（未进过、非前台路径）。
    for (const [i, text] of ["一", "二", "三"].entries()) {
      app.handleNapcatEvent({
        type: "napcat_group_message",
        data: fgMessage(text, { messageId: 150 + i }),
      });
    }
    await app.onFocus();

    const opening = app.openConversation("qq_group:1");
    resolveFetch([]); // 合法的空历史响应
    const opened = await opening;

    expect(opened.content).toContain("一");
    expect(opened.content).toContain("三");
    expect(opened.content).not.toContain("暂无最近消息");
  });

  it("被缓冲挤掉的 @ 在 drain 提示行里带出（红队 P2）", async () => {
    const app = await createFocusedApp({});
    // 第 1 条带 @，随后 7 条把它挤出缓冲（recentMessageLimit=5）。
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: {
        ...fgMessage("@小镜 在吗", { messageId: 160 }),
        messageSegments: [
          { type: "at", data: { qq: "10001" } } as NapcatReceiveMessageSegment,
          { type: "text", data: { text: " 在吗" } } as NapcatReceiveMessageSegment,
        ],
      },
    });
    for (let i = 1; i <= 7; i += 1) {
      app.handleNapcatEvent({
        type: "napcat_group_message",
        data: fgMessage(`刷屏${i}`, { messageId: 160 + i }),
      });
    }

    const input = await app.drainForegroundInput();

    expect(input?.text).toContain("（更早 3 条未读未展示，其中有人 @ 你）");
  });

  it("fetch 抛错：降级为空历史、会话照常打开、缓冲未读兜底展示（不硬失败）", async () => {
    const gateway = fakeGateway({
      getRecentGroupMessages: vi.fn().mockRejectedValue(new Error("napcat 挂了")),
    });
    const scheduler = new FakeScheduler();
    const app = createApp(scheduler, vi.fn(), { napcatGateway: gateway });
    await app.onStartup();
    await app.onFocus();
    app.handleNapcatEvent({
      type: "napcat_group_message",
      data: fgMessage("别丢我", { messageId: 91 }),
    });

    // 拉历史失败不再让 open 硬抛错：降级为空历史，会话照常打开。空历史 + 有缓冲未读时走
    // 「退化为直接展示缓冲」路径，消息不被静默吞——当场兜底展示，而非丢弃。
    const opened = await app.openConversation("qq_group:1");
    expect(opened.ok).toBe(true);
    expect(opened.content).toContain("别丢我");
  });
});

describe("QqApp 群禁言通知", () => {
  function banEvent(overrides: Partial<NapcatGroupBanData> = {}): {
    type: "napcat_group_ban";
    data: NapcatGroupBanData;
  } {
    return {
      type: "napcat_group_ban",
      data: {
        groupId: "1",
        subType: "ban",
        targetUserId: "10002",
        targetName: "李四",
        operatorUserId: "10001",
        operatorName: "张三",
        durationSeconds: 600,
        time: null,
        ...overrides,
      },
    };
  }

  it("自己被禁言：计未读 + 通知带裸正文预览 + 更新禁言态", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const muteStore = new GroupMuteStateStore();
    const app = createApp(scheduler, onFlush, { muteStore });
    await app.onStartup();

    app.handleNapcatEvent(banEvent({ targetUserId: "10001", targetName: null }));
    scheduler.fireWindowEnd();

    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "产品群: 你被 张三(10001) 禁言了 10 分钟"]);
    expect(muteStore.check("1")).toMatchObject({ muted: true, reason: "self" });
  });

  it("群友被解禁：同路径走对应文案（不动禁言态）", async () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const muteStore = new GroupMuteStateStore();
    const app = createApp(scheduler, onFlush, { muteStore });
    await app.onStartup();

    app.handleNapcatEvent(banEvent({ subType: "lift_ban", durationSeconds: 0 }));
    scheduler.fireWindowEnd();

    expect(onFlush.mock.calls[0][0]).toEqual([
      "QQ:",
      "产品群: 张三(10001) 解除了 李四(10002) 的禁言",
    ]);
    // 群友解禁不影响小镜自己的禁言态。
    expect(muteStore.check("1")).toEqual({ muted: false });
  });

  it("全员禁言开：更新 whole 态", () => {
    const muteStore = new GroupMuteStateStore();
    const app = createApp(new FakeScheduler(), vi.fn(), { muteStore });
    app.handleNapcatEvent(banEvent({ targetUserId: null, targetName: null }));
    expect(muteStore.check("1")).toEqual({ muted: true, reason: "whole" });
  });

  it("首开会话时 notice 不被历史覆盖吞掉：不进首开块 + 敲门 + 下一轮 drain 渲染 <qq_notice>", async () => {
    const scheduler = new FakeScheduler();
    const notifyForegroundInput = vi.fn();
    const napcatGateway = fakeGateway({
      getRecentGroupMessages: vi.fn().mockResolvedValue([groupMessage("历史消息")]),
    });
    const app = createApp(scheduler, vi.fn(), { notifyForegroundInput, napcatGateway });
    await app.onStartup();

    // 群友被禁言（非前台当前会话）→ 进缓冲。
    app.handleNapcatEvent(banEvent());

    const open = await app.openConversation("qq_group:1");
    expect(open.content).toContain("历史消息"); // 首开块展示的是历史
    expect(open.content).not.toContain("<qq_notice>"); // notice 不在首开渲染结果里
    expect(notifyForegroundInput).toHaveBeenCalled(); // 敲门：留存的 notice 等下一轮 drain

    const drained = await app.drainForegroundInput();
    expect(drained?.text).toContain(
      "<qq_notice>李四(10002) 被 张三(10001) 禁言了 10 分钟</qq_notice>",
    );
  });

  it("onStartup 用 groupAllShut 恢复全员禁言态（无需先失败一次）", async () => {
    const muteStore = new GroupMuteStateStore();
    const napcatGateway = fakeGateway({
      getGroupInfo: vi.fn().mockResolvedValue({
        groupId: "1",
        groupName: "产品群",
        memberCount: 1,
        maxMemberCount: 2,
        groupRemark: "",
        groupAllShut: true,
      }),
    });
    const app = createApp(new FakeScheduler(), vi.fn(), { muteStore, napcatGateway });
    await app.onStartup();
    expect(muteStore.check("1")).toEqual({ muted: true, reason: "whole" });
  });
});
