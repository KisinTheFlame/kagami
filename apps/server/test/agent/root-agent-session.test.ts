import { describe, expect, it, vi } from "vitest";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";

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
  getRecentGroupMessages = vi.fn().mockResolvedValue([]),
  ithomeNewsService,
}: {
  context: DefaultAgentContext;
  getRecentGroupMessages?: ReturnType<typeof vi.fn>;
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
      getGroupInfo: vi.fn().mockImplementation(async ({ groupId }) => ({
        groupId,
        groupName: groupId === "group-1" ? "产品群" : "测试群",
        memberCount: 123,
        maxMemberCount: 500,
        groupRemark: "",
        groupAllShut: false,
      })),
      getRecentGroupMessages,
    },
    listenGroupIds: ["group-1", "group-2"],
    recentMessageLimit: 2,
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
});
