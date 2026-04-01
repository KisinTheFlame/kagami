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
  it("should initialize portal snapshot and buffer unread while in portal", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    const consumeResult = await session.consumeIncomingEvent(createGroupEvent("hello", "group-1"));
    const result = await session.flushPendingIncomingEffects();

    expect(consumeResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(result).toEqual({
      shouldTriggerRound: true,
    });
    const snapshot = await context.getSnapshot();
    expect(snapshot.messages.at(-1)?.content).toContain(
      'QQ 群 产品群（group-1），尚未查看，可通过 enter(kind="qq_group", id="group-1")',
    );
    expect(snapshot.messages.at(-1)?.content).toContain('enter(kind="zone_out")');
  });

  it("should drain post-tool effects without mutating context until persisted", async () => {
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
    await session.enter({ kind: "qq_group", id: "group-1" });

    const postToolEffects = await session.flushPendingPostToolEffects();
    expect(postToolEffects.messages).toHaveLength(1);
    expect(postToolEffects.events).toHaveLength(0);
    expect(postToolEffects.messages[0]?.content).toContain("history-1");

    await applyPostToolEffects(context, postToolEffects);

    const persistedSnapshot = await context.getSnapshot();
    expect(
      persistedSnapshot.messages.some(
        message => typeof message.content === "string" && message.content.includes("history-1"),
      ),
    ).toBe(true);
  });

  it("should use history on first enter, unread tail on re-enter, and not surface background events in qq group", async () => {
    const getRecentGroupMessages = vi
      .fn()
      .mockResolvedValueOnce([
        createHistoryMessage("history-1", "group-1"),
        createHistoryMessage("history-2", "group-1"),
      ])
      .mockResolvedValue([]);
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({
      context,
      getRecentGroupMessages,
    });

    await session.initializeContext();
    await session.consumeIncomingEvent(createGroupEvent("portal-unread-1", "group-1"));
    await session.consumeIncomingEvent(createGroupEvent("portal-unread-2", "group-1"));
    await session.flushPendingIncomingEffects();
    await expect(session.enter({ kind: "qq_group", id: "group-1" })).resolves.toMatchObject({
      ok: true,
      kind: "qq_group",
      id: "group-1",
      source: "history",
      hydratedCount: 2,
    });
    let postToolEffects = await session.flushPendingPostToolEffects();
    expect(postToolEffects.messages).toHaveLength(1);
    expect(postToolEffects.events).toHaveLength(0);
    expect(postToolEffects.messages[0]?.content).toContain("history-1");
    expect(postToolEffects.messages[0]?.content).toContain("history-2");
    await applyPostToolEffects(context, postToolEffects);

    const backgroundResults = await Promise.all([
      session.consumeIncomingEvent(createGroupEvent("b-1", "group-2")),
      session.consumeIncomingEvent(createGroupEvent("b-2", "group-2")),
      session.consumeIncomingEvent(createGroupEvent("b-3", "group-2")),
    ]);
    const backgroundResult = await session.flushPendingIncomingEffects();

    expect(backgroundResults).toEqual([
      { shouldTriggerRound: false },
      { shouldTriggerRound: false },
      { shouldTriggerRound: false },
    ]);
    expect(backgroundResult).toEqual({
      shouldTriggerRound: false,
    });
    await expect(session.backToPortal()).resolves.toMatchObject({
      ok: true,
      kind: "qq_group",
      id: "group-1",
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    let snapshot = await context.getSnapshot();
    let contents = snapshot.messages.flatMap(message =>
      typeof message.content === "string" ? [message.content] : [],
    );
    expect(contents.some(content => content.includes("QQ 群 产品群（group-1），未读 0 条"))).toBe(
      true,
    );
    expect(
      contents.some(content =>
        content.includes(
          'QQ 群 测试群（group-2），尚未查看，可通过 enter(kind="qq_group", id="group-2")',
        ),
      ),
    ).toBe(true);

    await expect(session.enter({ kind: "qq_group", id: "group-2" })).resolves.toMatchObject({
      ok: true,
      kind: "qq_group",
      id: "group-2",
      source: "history",
      hydratedCount: 0,
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    await expect(session.backToPortal()).resolves.toMatchObject({
      ok: true,
      kind: "qq_group",
      id: "group-2",
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await session.consumeIncomingEvent(createGroupEvent("b-4", "group-2"));
    await session.consumeIncomingEvent(createGroupEvent("b-5", "group-2"));
    await session.consumeIncomingEvent(createGroupEvent("b-6", "group-2"));
    await session.flushPendingIncomingEffects();

    await expect(session.enter({ kind: "qq_group", id: "group-2" })).resolves.toMatchObject({
      ok: true,
      kind: "qq_group",
      id: "group-2",
      source: "unread",
      hydratedCount: 2,
    });
    postToolEffects = await session.flushPendingPostToolEffects();
    expect(postToolEffects.messages).toHaveLength(1);
    expect(postToolEffects.events).toHaveLength(0);
    expect(postToolEffects.messages[0]?.content).toContain("b-5");
    expect(postToolEffects.messages[0]?.content).toContain("b-6");
    await applyPostToolEffects(context, postToolEffects);

    snapshot = await context.getSnapshot();
    contents = snapshot.messages.flatMap(message =>
      typeof message.content === "string" ? [message.content] : [],
    );
    expect(
      contents.filter(content => content.includes("history-1") && content.includes("history-2")),
    ).toHaveLength(1);
    expect(
      contents.filter(content => content.includes("b-5") && content.includes("b-6")),
    ).toHaveLength(1);
    expect(contents.some(content => content.includes("history-1"))).toBe(true);
    expect(contents.some(content => content.includes("b-5"))).toBe(true);
    expect(contents.some(content => content.includes("b-6"))).toBe(true);
    expect(contents.some(content => content.includes("b-4"))).toBe(false);
  });

  it("should enter zone out and return to portal", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    await expect(session.enter({ kind: "zone_out" })).resolves.toMatchObject({
      ok: true,
      kind: "zone_out",
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    expect(session.getState()).toEqual({
      kind: "zone_out",
    });

    await expect(session.backToPortal()).resolves.toMatchObject({
      ok: true,
      kind: "zone_out",
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    expect(session.getState()).toEqual({
      kind: "portal",
    });
    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("你已进入神游状态"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message => typeof message.content === "string" && message.content.includes("你已结束神游"),
      ),
    ).toBe(true);
  });

  it("should interrupt waiting in qq group and surface same-group message immediately", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    await session.enter({ kind: "qq_group", id: "group-1" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await session.wait({
      deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
    });

    const consumeResult = await session.consumeIncomingEvent(
      createGroupEvent("wake-up", "group-1"),
    );
    const flushResult = await session.flushPendingIncomingEffects();

    expect(consumeResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(session.getState()).toEqual({
      kind: "qq_group",
      groupId: "group-1",
    });

    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("等待被新的外部事件打断了") &&
          message.content.includes("QQ 群 产品群（group-1）收到了新消息"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message => typeof message.content === "string" && message.content.includes("wake-up"),
      ),
    ).toBe(true);
  });

  it("should interrupt waiting in qq group on background message and keep unread state", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    await session.enter({ kind: "qq_group", id: "group-1" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await session.wait({
      deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
    });

    const consumeResult = await session.consumeIncomingEvent(
      createGroupEvent("background-wake", "group-2"),
    );
    const flushResult = await session.flushPendingIncomingEffects();

    expect(consumeResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(session.getState()).toEqual({
      kind: "qq_group",
      groupId: "group-1",
    });

    const dashboardSnapshot = session.getDashboardSnapshot();
    expect(dashboardSnapshot.groups.find(group => group.groupId === "group-2")?.unreadCount).toBe(
      1,
    );

    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("等待被新的外部事件打断了") &&
          message.content.includes("QQ 群 测试群（group-2）收到了新消息"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("background-wake"),
      ),
    ).toBe(false);
  });

  it("should finish waiting after timeout and return to previous state", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    await session.enter({ kind: "zone_out" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await session.wait({
      deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
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
      kind: "zone_out",
    });

    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("等待自然结束了") &&
          message.content.includes("你现在已回到：神游状态"),
      ),
    ).toBe(true);
  });

  it("should enter ithome, open article and return to portal", async () => {
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
        openArticle: vi.fn().mockResolvedValue({
          articleId: 1,
          title: "测试文章",
          url: "https://www.ithome.com/1.htm",
          publishedAt: new Date("2026-03-30T04:21:03.000Z"),
          content: "文章正文",
          contentSource: "article_content",
          truncated: false,
          maxChars: 8000,
        }),
      },
    });

    await session.initializeContext();
    await expect(session.enter({ kind: "ithome" })).resolves.toMatchObject({
      ok: true,
      kind: "ithome",
      articleCount: 1,
    });
    expect(session.getAvailableInvokeTools()).toEqual(["open_ithome_article"]);
    expect(session.getDashboardSnapshot().availableInvokeTools).toEqual(["open_ithome_article"]);
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await expect(session.openIthomeArticle({ articleId: 1 })).resolves.toMatchObject({
      ok: true,
      kind: "ithome_article",
      articleId: 1,
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await expect(session.backToPortal()).resolves.toMatchObject({
      ok: true,
      kind: "ithome",
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("<ithome_article_list>"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("<ithome_article>"),
      ),
    ).toBe(true);
  });

  it("should interrupt waiting in ithome and restore ithome state", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({
      context,
      ithomeNewsService: {
        getFeedOverview: vi.fn().mockResolvedValue({
          sourceKey: "ithome",
          displayName: "IT之家",
          unreadCount: 0,
          hasEntered: true,
        }),
        enterFeed: vi.fn().mockResolvedValue({
          sourceKey: "ithome",
          displayName: "IT之家",
          mode: "latest",
          hiddenNewCount: 0,
          articles: [],
        }),
        openArticle: vi.fn(),
      },
    });

    await session.initializeContext();
    await session.enter({ kind: "ithome" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await session.wait({
      deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
    });

    const consumeResult = await session.consumeIncomingEvent({
      type: "news_article_ingested",
      data: {
        sourceKey: "ithome",
        articleId: 1,
        title: "新文章",
      },
    });
    const flushResult = await session.flushPendingIncomingEffects();

    expect(consumeResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(session.getState()).toEqual({
      kind: "ithome",
    });

    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("等待被新的外部事件打断了") &&
          message.content.includes("IT之家 有新文章《新文章》"),
      ),
    ).toBe(true);
  });

  it("should preserve waiting resume state when exporting and restoring session snapshot", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({ context });

    await session.initializeContext();
    await session.enter({ kind: "qq_group", id: "group-1" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await session.wait({
      deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
    });

    const exportedContext = await context.exportPersistedSnapshot();
    const exportedSession = session.exportPersistedSnapshot();

    const restoredContext = new DefaultAgentContext({
      systemPromptFactory: () => "new-system-prompt",
    });
    await restoredContext.restorePersistedSnapshot(exportedContext);
    const restoredSession = createSession({ context: restoredContext });
    restoredSession.restorePersistedSnapshot(exportedSession);

    expect(restoredSession.getState()).toEqual({
      kind: "waiting",
      deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
      resumeState: {
        kind: "qq_group",
        groupId: "group-1",
      },
    });

    const timeoutResult = await restoredSession.finishWaitingIfExpired(
      new Date("2026-03-30T12:05:01.000Z"),
    );
    const flushResult = await restoredSession.flushPendingIncomingEffects();

    expect(timeoutResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(flushResult).toEqual({
      shouldTriggerRound: true,
    });
    expect(restoredSession.getState()).toEqual({
      kind: "qq_group",
      groupId: "group-1",
    });

    const restoredSnapshot = await restoredContext.getSnapshot();
    expect(
      restoredSnapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("你现在已回到：QQ 群 产品群（group-1）"),
      ),
    ).toBe(true);
    expect(restoredSession.getState()).toEqual({
      kind: "qq_group",
      groupId: "group-1",
    });
  });

  it("should export and restore persisted session snapshot without duplicating portal snapshot", async () => {
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
    await session.consumeIncomingEvent(createGroupEvent("portal-unread-1", "group-1"));
    await session.flushPendingIncomingEffects();
    await session.enter({ kind: "qq_group", id: "group-1" });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
    await session.backToPortal();
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    const originalSnapshot = await context.getSnapshot();
    const originalPortalMessageCount = originalSnapshot.messages.filter(
      message =>
        typeof message.content === "string" && message.content.includes("你当前处于门户状态"),
    ).length;
    const exportedContext = await context.exportPersistedSnapshot();
    const exportedSession = session.exportPersistedSnapshot();

    const restoredContext = new DefaultAgentContext({
      systemPromptFactory: () => "new-system-prompt",
    });
    await restoredContext.restorePersistedSnapshot(exportedContext);
    const restoredSession = createSession({ context: restoredContext });
    restoredSession.restorePersistedSnapshot(exportedSession);

    await restoredSession.initializeContext();

    expect(restoredSession.getState()).toEqual({
      kind: "portal",
    });
    expect(restoredSession.getDashboardSnapshot().groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupId: "group-1",
          hasEntered: true,
        }),
      ]),
    );

    const restoredSnapshot = await restoredContext.getSnapshot();
    const portalMessages = restoredSnapshot.messages.filter(
      message =>
        typeof message.content === "string" && message.content.includes("你当前处于门户状态"),
    );
    expect(portalMessages).toHaveLength(originalPortalMessageCount);
  });

  it("should reset session state back to a fresh portal state", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = createSession({
      context,
      getRecentGroupMessages: vi
        .fn()
        .mockResolvedValue([createHistoryMessage("history-1", "group-1")]),
      ithomeNewsService: {
        getFeedOverview: vi.fn().mockResolvedValue({
          sourceKey: "ithome",
          displayName: "IT之家",
          unreadCount: 2,
          hasEntered: true,
        }),
        enterFeed: vi.fn().mockResolvedValue({
          sourceKey: "ithome",
          displayName: "IT之家",
          mode: "new",
          hiddenNewCount: 0,
          articles: [],
        }),
        openArticle: vi.fn().mockResolvedValue(null),
      },
    });

    await session.initializeContext();
    await session.consumeIncomingEvent(createGroupEvent("portal-unread-1", "group-1"));
    await session.flushPendingIncomingEffects();
    await session.enter({ kind: "qq_group", id: "group-1" });
    await session.flushPendingPostToolEffects();

    session.reset();

    expect(session.getState()).toEqual({
      kind: "portal",
    });
    expect(session.getDashboardSnapshot().groups).toEqual([
      expect.objectContaining({
        groupId: "group-1",
        unreadCount: 0,
        hasEntered: false,
      }),
      expect.objectContaining({
        groupId: "group-2",
        unreadCount: 0,
        hasEntered: false,
      }),
    ]);

    await session.initializeContext();
    const snapshot = await context.getSnapshot();
    const portalMessageCount = snapshot.messages.filter(
      message =>
        typeof message.content === "string" && message.content.includes("你当前处于门户状态"),
    ).length;
    expect(portalMessageCount).toBeGreaterThanOrEqual(1);
  });
});
