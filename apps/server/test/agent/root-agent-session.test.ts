import { describe, expect, it, vi } from "vitest";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

function createGroupEvent(message: string, groupId: string) {
  return {
    type: "napcat_group_message" as const,
    data: {
      groupId,
      userId: "654321",
      nickname: "测试昵称",
      rawMessage: message,
      messageSegments: [
        {
          type: "text" as const,
          data: {
            text: message,
          },
        },
      ],
      messageId: 1001,
      time: 1710000000,
    },
  };
}

function createHistoryMessage(message: string, groupId: string) {
  return {
    groupId,
    userId: "123456",
    nickname: "历史群友",
    rawMessage: message,
    messageSegments: [
      {
        type: "text" as const,
        data: {
          text: message,
        },
      },
    ],
    messageId: 2001,
    time: 1710000100,
  };
}

function createPrivateEvent(message: string, userId: string) {
  return {
    type: "napcat_private_message" as const,
    data: {
      userId,
      nickname: "测试好友",
      remark: "好友备注",
      rawMessage: message,
      messageSegments: [
        {
          type: "text" as const,
          data: {
            text: message,
          },
        },
      ],
      messageId: 3001,
      time: 1710000200,
    },
  };
}

function createFriendListUpdatedEvent(
  friends: Array<{
    userId: string;
    nickname: string;
    remark: string | null;
  }>,
) {
  return {
    type: "napcat_friend_list_updated" as const,
    data: {
      friends,
    },
  };
}

async function applyPostToolEffects(
  context: DefaultAgentContext,
  effects: Awaited<ReturnType<RootAgentSession["flushPendingPostToolEffects"]>>,
): Promise<void> {
  if (effects.messages.length > 0) {
    await context.appendMessages(effects.messages);
  }

  if (effects.events.length > 0) {
    await context.appendEvents(effects.events);
  }
}

function createSession({
  context,
  getGroupInfo = vi.fn().mockImplementation(async ({ groupId }) => ({
    groupId,
    groupName: groupId === "group-1" ? "产品群" : "测试群",
    memberCount: 123,
    maxMemberCount: 500,
    groupRemark: "",
    groupAllShut: false,
  })),
  getRecentGroupMessages = vi.fn().mockResolvedValue([]),
  getRecentPrivateMessages = vi.fn().mockResolvedValue([]),
  getFriendList = vi.fn().mockResolvedValue([]),
  ithomeNewsService,
  notificationTimeWindowMs,
}: {
  context: DefaultAgentContext;
  getGroupInfo?: ReturnType<typeof vi.fn>;
  getRecentGroupMessages?: ReturnType<typeof vi.fn>;
  getRecentPrivateMessages?: ReturnType<typeof vi.fn>;
  getFriendList?: ReturnType<typeof vi.fn>;
  notificationTimeWindowMs?: number;
  ithomeNewsService?: {
    getFeedOverview(): Promise<{
      sourceKey: "ithome";
      displayName: string;
      unreadCount: number;
      hasEntered: boolean;
    }>;
    enterFeed(): Promise<{
      sourceKey: "ithome";
      displayName: string;
      mode: "latest" | "new";
      hiddenNewCount: number;
      articles: Array<{
        id: number;
        title: string;
        url: string;
        publishedAt: Date;
        rssSummary: string;
      }>;
    }>;
    openArticle(input: { articleId: number }): Promise<{
      articleId: number;
      title: string;
      url: string;
      publishedAt: Date;
      content: string;
      contentSource: "article_content" | "rss_summary";
      truncated: boolean;
      maxChars: number;
    } | null>;
  };
}) {
  return new RootAgentSession({
    context,
    napcatGatewayService: {
      start: vi.fn(),
      stop: vi.fn(),
      sendGroupMessage: vi.fn(),
      sendPrivateMessage: vi.fn(),
      getFriendList,
      getGroupInfo,
      getRecentGroupMessages,
      getRecentPrivateMessages,
    },
    listenGroupIds: ["group-1", "group-2"],
    recentMessageLimit: 2,
    notificationTimeWindowMs,
    ithomeNewsService,
  });
}

describe("RootAgentSession", () => {
  it("should initialize with a system_reminder for portal children", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();

    const snapshot = await context.getSnapshot();
    const lastMessage = snapshot.messages.at(-1);

    expect(session.getState()).toEqual({
      focusedStateId: "portal",
      stateStack: ["portal"],
      waiting: null,
    });
    expect(lastMessage?.content).toContain("<system_reminder>");
    expect(lastMessage?.content).toContain("你进入了 门户 节点");
    expect(lastMessage?.content).toContain("QQ 群 产品群 (group-1) (qq_group:group-1)");
    expect(lastMessage?.content).toContain("当前可用的 invoke 工具：无");
  });

  it("should enter child state by state id and back one level", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({
      context,
      getRecentGroupMessages: vi
        .fn()
        .mockResolvedValue([createHistoryMessage("history-1", "group-1")]),
    });

    await session.initializeContext();
    await expect(session.enter({ id: "qq_group:group-1" })).resolves.toMatchObject({
      ok: true,
      id: "qq_group:group-1",
      displayName: "QQ 群 产品群 (group-1)",
      message: "已进入QQ 群 产品群 (group-1)",
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    expect(session.getState()).toEqual({
      focusedStateId: "qq_group:group-1",
      stateStack: ["portal", "qq_group:group-1"],
      waiting: null,
    });
    expect(session.getCurrentGroupId()).toBe("group-1");
    expect(session.getAvailableInvokeTools()).toEqual(["send_message"]);
    const snapshotAfterEnter = await context.getSnapshot();
    const stateReminder = snapshotAfterEnter.messages.find(
      message =>
        typeof message.content === "string" &&
        message.content.includes("当前可用的 invoke 工具：send_message"),
    );
    expect(stateReminder?.content).not.toContain("要发送到群里的文本内容。");

    await expect(session.back()).resolves.toMatchObject({
      ok: true,
      id: "qq_group:group-1",
      displayName: "QQ 群 产品群 (group-1)",
      message: "已退出QQ 群 产品群 (group-1)",
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    expect(session.getState()).toEqual({
      focusedStateId: "portal",
      stateStack: ["portal"],
      waiting: null,
    });
    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message => typeof message.content === "string" && message.content.includes("history-1"),
      ),
    ).toBe(true);
  });

  it("should refresh portal reminder when background child state changes", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    const consumeResult = await session.consumeIncomingEvent(createGroupEvent("hello", "group-1"));
    const flushResult = await session.flushPendingIncomingEffects();

    expect(consumeResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });

    const snapshot = await context.getSnapshot();
    const reminderMessages = snapshot.messages.filter(
      message =>
        typeof message.content === "string" && message.content.includes("<system_reminder>"),
    );
    expect(reminderMessages.at(-1)?.content).toContain("未读 1 条消息");
  });

  it("should treat wait as an overlay and restore the focused state after timeout", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    await session.enter({ id: "zone_out" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await session.wait({
      deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
    });

    expect(session.getState()).toEqual({
      focusedStateId: "zone_out",
      stateStack: ["portal", "zone_out"],
      waiting: {
        deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
        resumeStateId: "zone_out",
      },
    });

    const result = await session.finishWaitingIfExpired(new Date("2026-03-30T12:05:01.000Z"));
    const flushResult = await session.flushPendingIncomingEffects();

    expect(result).toEqual({
      shouldTriggerRound: true,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(session.getState()).toEqual({
      focusedStateId: "zone_out",
      stateStack: ["portal", "zone_out"],
      waiting: null,
    });

    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("等待自然结束了") &&
          message.content.includes("神游"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("<system_reminder>") &&
          message.content.includes("你进入了 神游 节点"),
      ),
    ).toBe(true);
  });

  it("should show group name when wait is interrupted by a group message", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    await session.enter({ id: "zone_out" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await session.wait({
      deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
    });

    const result = await session.consumeIncomingEvent(createGroupEvent("hello", "group-1"));
    const flushResult = await session.flushPendingIncomingEffects();

    expect(result).toEqual({
      shouldTriggerRound: true,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });

    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("等待被新的外部事件打断了") &&
          message.content.includes("打断等待的事件：QQ 群 产品群 收到了新消息。"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("打断等待的事件：QQ 群 group-1 收到了新消息。"),
      ),
    ).toBe(false);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("打断等待的事件：QQ 群 产品群 (group-1) 收到了新消息。"),
      ),
    ).toBe(false);
  });

  it("should show unread count instead of preview in cross-state group notifications", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({
      context,
      notificationTimeWindowMs: 0,
    });

    await session.initializeContext();
    await session.enter({ id: "zone_out" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    const consumeResult = await session.consumeIncomingEvent(createGroupEvent("hello", "group-2"));
    const flushResult = await session.flushPendingIncomingEffects();

    expect(consumeResult).toEqual({
      shouldTriggerRound: false,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });

    const snapshot = await context.getSnapshot();
    const notificationMessage = [...snapshot.messages]
      .reverse()
      .find(
        message =>
          typeof message.content === "string" && message.content.includes("[跨状态通知]"),
      );

    expect(notificationMessage?.content).toContain("QQ 群 测试群 (group-2)：未读 1 条消息。");
    expect(notificationMessage?.content).not.toContain("测试昵称");
    expect(notificationMessage?.content).not.toContain("hello");
  });

  it("should show latest total unread count for repeated group notifications in the same batch", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({
      context,
      notificationTimeWindowMs: 0,
    });

    await session.initializeContext();
    await session.enter({ id: "zone_out" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    await session.consumeIncomingEvent(createGroupEvent("hello-1", "group-2"));
    await session.consumeIncomingEvent(createGroupEvent("hello-2", "group-2"));
    const flushResult = await session.flushPendingIncomingEffects();

    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });

    const snapshot = await context.getSnapshot();
    const notificationMessages = snapshot.messages.filter(
      message =>
        typeof message.content === "string" && message.content.includes("[跨状态通知]"),
    );

    expect(notificationMessages).toHaveLength(1);
    expect(notificationMessages[0]?.content).toContain("QQ 群 测试群 (group-2)：未读 2 条消息。");
    expect(notificationMessages[0]?.content).not.toContain("hello-1");
    expect(notificationMessages[0]?.content).not.toContain("hello-2");
  });

  it("should restore persisted waiting snapshot in the current stack + wait overlay shape", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    session.restorePersistedSnapshot({
      stateStack: ["portal", "qq_group:group-1"],
      waitOverlay: {
        deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
        resumeStateStack: ["portal", "qq_group:group-1"],
      },
      groups: [
        {
          groupId: "group-1",
          groupInfo: {
            groupId: "group-1",
            groupName: "产品群",
            memberCount: 123,
            maxMemberCount: 500,
            groupRemark: "",
            groupAllShut: false,
          },
          unreadMessages: [],
          hasEntered: true,
        },
        {
          groupId: "group-2",
          groupInfo: null,
          unreadMessages: [],
          hasEntered: false,
        },
      ],
      privateChats: [],
      ithomeFeedState: null,
    });

    expect(session.getState()).toEqual({
      focusedStateId: "qq_group:group-1",
      stateStack: ["portal", "qq_group:group-1"],
      waiting: {
        deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
        resumeStateId: "qq_group:group-1",
      },
    });

    const exportedSnapshot = session.exportPersistedSnapshot();
    expect(exportedSnapshot).toMatchObject({
      stateStack: ["portal", "qq_group:group-1"],
      waitOverlay: {
        deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
        resumeStateStack: ["portal", "qq_group:group-1"],
      },
    });
  });

  it("should expose focused state dashboard information", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({
      context,
      ithomeNewsService: {
        getFeedOverview: vi.fn().mockResolvedValue({
          sourceKey: "ithome",
          displayName: "IT之家",
          unreadCount: 1,
          hasEntered: false,
        }),
        enterFeed: vi.fn().mockResolvedValue({
          sourceKey: "ithome",
          displayName: "IT之家",
          mode: "new",
          hiddenNewCount: 0,
          articles: [
            {
              id: 1,
              title: "测试文章",
              url: "https://www.ithome.com/1.htm",
              publishedAt: new Date("2026-03-30T04:21:03.000Z"),
              rssSummary: "文章摘要",
            },
          ],
        }),
        openArticle: vi.fn().mockResolvedValue(null),
      },
    });

    await session.initializeContext();
    const dashboard = await session.getDashboardSnapshot();

    expect(dashboard.focusedStateId).toBe("portal");
    expect(dashboard.stateStack).toEqual([{ id: "portal", displayName: "门户" }]);
    expect(dashboard.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "qq_group:group-1",
        }),
        expect.objectContaining({
          id: "ithome",
        }),
        expect.objectContaining({
          id: "zone_out",
        }),
      ]),
    );
  });

  it("should list qq private child states after consuming friend list update event", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    const snapshotBeforeEvent = await context.getSnapshot();
    const consumeResult = await session.consumeIncomingEvent(
      createFriendListUpdatedEvent([
        {
          userId: "user-2",
          nickname: "新好友",
          remark: "新备注",
        },
      ]),
    );
    const flushResult = await session.flushPendingIncomingEffects();
    const dashboard = await session.getDashboardSnapshot();
    const snapshotAfterEvent = await context.getSnapshot();

    expect(consumeResult).toEqual({
      shouldTriggerRound: false,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: false,
    });
    expect(snapshotAfterEvent.messages).toEqual(snapshotBeforeEvent.messages);
    expect(dashboard.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "qq_private:user-2",
          displayName: "QQ 私聊 新备注 (user-2)",
        }),
      ]),
    );
  });

  it("should update private chat display name after consuming friend list update event", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    await session.consumeIncomingEvent(
      createFriendListUpdatedEvent([
        {
          userId: "user-2",
          nickname: "老昵称",
          remark: null,
        },
      ]),
    );
    await session.flushPendingIncomingEffects();

    await session.consumeIncomingEvent(
      createFriendListUpdatedEvent([
        {
          userId: "user-2",
          nickname: "新昵称",
          remark: "新备注",
        },
      ]),
    );
    await session.flushPendingIncomingEffects();

    const dashboard = await session.getDashboardSnapshot();
    expect(dashboard.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "qq_private:user-2",
          displayName: "QQ 私聊 新备注 (user-2)",
        }),
      ]),
    );
  });

  it("should create qq private child state from incoming private message and enter it", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({
      context,
      getRecentPrivateMessages: vi.fn().mockResolvedValue([
        {
          messageType: "private",
          subType: "friend",
          groupId: null,
          userId: "user-1",
          nickname: "测试好友",
          rawMessage: "history-private",
          messageSegments: [
            {
              type: "text",
              data: {
                text: "history-private",
              },
            },
          ],
          messageId: 4001,
          time: 1710000300,
          payload: {},
        },
      ]),
    });

    await session.initializeContext();
    const consumeResult = await session.consumeIncomingEvent(
      createPrivateEvent("hello-private", "user-1"),
    );
    const flushResult = await session.flushPendingIncomingEffects();

    expect(consumeResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });

    const dashboard = await session.getDashboardSnapshot();
    expect(dashboard.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "qq_private:user-1",
          displayName: "QQ 私聊 好友备注 (user-1)",
        }),
      ]),
    );

    await expect(session.enter({ id: "qq_private:user-1" })).resolves.toMatchObject({
      ok: true,
      id: "qq_private:user-1",
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    expect(session.getCurrentChatTarget()).toEqual({
      chatType: "private",
      userId: "user-1",
    });
    expect(session.getCurrentGroupId()).toBeUndefined();
    expect(session.getAvailableInvokeTools()).toEqual(["send_message"]);

    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("history-private"),
      ),
    ).toBe(true);
  });

  it("should show unread count instead of preview in cross-state private notifications", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({
      context,
      notificationTimeWindowMs: 0,
    });

    await session.initializeContext();
    await session.enter({ id: "zone_out" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    const consumeResult = await session.consumeIncomingEvent(
      createPrivateEvent("hello-private", "user-1"),
    );
    const flushResult = await session.flushPendingIncomingEffects();

    expect(consumeResult).toEqual({
      shouldTriggerRound: false,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });

    const snapshot = await context.getSnapshot();
    const notificationMessage = [...snapshot.messages]
      .reverse()
      .find(
        message =>
          typeof message.content === "string" && message.content.includes("[跨状态通知]"),
      );

    expect(notificationMessage?.content).toContain("QQ 私聊 好友备注 (user-1)：未读 1 条消息。");
    expect(notificationMessage?.content).not.toContain("测试好友");
    expect(notificationMessage?.content).not.toContain("hello-private");
  });
});
