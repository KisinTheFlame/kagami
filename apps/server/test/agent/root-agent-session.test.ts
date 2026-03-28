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

describe("RootAgentSession", () => {
  it("should initialize portal snapshot and buffer unread while in portal", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = new RootAgentSession({
      context,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn(),
        getRecentGroupMessages: vi.fn().mockResolvedValue([]),
      },
      listenGroupIds: ["group-1", "group-2"],
      recentMessageLimit: 2,
    });

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
    expect(snapshot.messages.at(-1)?.content).toContain("群 group-1，未读 1 条");
    expect(snapshot.messages.at(-1)?.content).toContain("群 group-2，未读 0 条");
  });

  it("should use history on first enter, unread tail on re-enter, and not surface background events in group", async () => {
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
    const session = new RootAgentSession({
      context,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn(),
        getRecentGroupMessages,
      },
      listenGroupIds: ["group-1", "group-2"],
      recentMessageLimit: 2,
    });

    await session.initializeContext();
    await session.consumeIncomingEvent(createGroupEvent("portal-unread-1", "group-1"));
    await session.consumeIncomingEvent(createGroupEvent("portal-unread-2", "group-1"));
    await session.flushPendingIncomingEffects();
    await expect(session.enterGroup({ groupId: "group-1" })).resolves.toMatchObject({
      ok: true,
      groupId: "group-1",
      source: "history",
      hydratedCount: 2,
    });
    await session.flushPendingPostToolEffects();

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
    await expect(session.exitGroup()).resolves.toMatchObject({
      ok: true,
      groupId: "group-1",
    });
    await session.flushPendingPostToolEffects();

    let snapshot = await context.getSnapshot();
    let contents = snapshot.messages.flatMap(message =>
      typeof message.content === "string" ? [message.content] : [],
    );
    expect(contents.some(content => content.includes("群 group-1，未读 0 条"))).toBe(true);

    await expect(session.enterGroup({ groupId: "group-2" })).resolves.toMatchObject({
      ok: true,
      groupId: "group-2",
      source: "history",
      hydratedCount: 0,
    });
    await session.flushPendingPostToolEffects();

    await expect(session.exitGroup()).resolves.toMatchObject({
      ok: true,
      groupId: "group-2",
    });
    await session.flushPendingPostToolEffects();
    await session.consumeIncomingEvent(createGroupEvent("b-4", "group-2"));
    await session.consumeIncomingEvent(createGroupEvent("b-5", "group-2"));
    await session.consumeIncomingEvent(createGroupEvent("b-6", "group-2"));
    await session.flushPendingIncomingEffects();

    await expect(session.enterGroup({ groupId: "group-2" })).resolves.toMatchObject({
      ok: true,
      groupId: "group-2",
      source: "unread",
      hydratedCount: 2,
    });
    await session.flushPendingPostToolEffects();

    snapshot = await context.getSnapshot();
    contents = snapshot.messages.flatMap(message =>
      typeof message.content === "string" ? [message.content] : [],
    );
    expect(contents.some(content => content.includes("history-1"))).toBe(true);
    expect(contents.some(content => content.includes("b-5"))).toBe(true);
    expect(contents.some(content => content.includes("b-6"))).toBe(true);
    expect(contents.some(content => content.includes("b-4"))).toBe(false);
  });
});
