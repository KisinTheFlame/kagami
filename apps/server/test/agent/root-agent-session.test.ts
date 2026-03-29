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
        getGroupInfo: vi.fn().mockImplementation(async ({ groupId }) => ({
          groupId,
          groupName: groupId === "group-1" ? "产品群" : "测试群",
          memberCount: 123,
          maxMemberCount: 500,
          groupRemark: "",
          groupAllShut: false,
        })),
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
    expect(snapshot.messages.at(-1)?.content).toContain(
      "群 产品群（group-1），尚未查看，可进入看看最近消息",
    );
    expect(snapshot.messages.at(-1)?.content).toContain(
      "群 测试群（group-2），尚未查看，可进入看看最近消息",
    );
  });

  it("should drain post-tool effects without mutating context until the runtime persists them", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = new RootAgentSession({
      context,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn().mockResolvedValue({
          groupId: "group-1",
          groupName: "产品群",
          memberCount: 123,
          maxMemberCount: 500,
          groupRemark: "",
          groupAllShut: false,
        }),
        getRecentGroupMessages: vi
          .fn()
          .mockResolvedValue([createHistoryMessage("history-1", "group-1")]),
      },
      listenGroupIds: ["group-1"],
      recentMessageLimit: 1,
    });

    await session.initializeContext();
    await session.enterGroup({ groupId: "group-1" });

    const beforeFlushSnapshot = await context.getSnapshot();
    expect(
      beforeFlushSnapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("你已进入群 group-1"),
      ),
    ).toBe(false);

    const postToolEffects = await session.flushPendingPostToolEffects();
    expect(postToolEffects.messages).toHaveLength(1);
    expect(postToolEffects.events).toHaveLength(1);

    const afterDrainSnapshot = await context.getSnapshot();
    expect(
      afterDrainSnapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("你已进入群 group-1"),
      ),
    ).toBe(false);

    await applyPostToolEffects(context, postToolEffects);

    const persistedSnapshot = await context.getSnapshot();
    expect(
      persistedSnapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("你已进入群 group-1"),
      ),
    ).toBe(true);
    expect(
      persistedSnapshot.messages.some(
        message => typeof message.content === "string" && message.content.includes("history-1"),
      ),
    ).toBe(true);
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
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

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
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    let snapshot = await context.getSnapshot();
    let contents = snapshot.messages.flatMap(message =>
      typeof message.content === "string" ? [message.content] : [],
    );
    expect(contents.some(content => content.includes("群 产品群（group-1），未读 0 条"))).toBe(
      true,
    );
    expect(
      contents.some(content =>
        content.includes("群 测试群（group-2），尚未查看，可进入看看最近消息"),
      ),
    ).toBe(true);

    await expect(session.enterGroup({ groupId: "group-2" })).resolves.toMatchObject({
      ok: true,
      groupId: "group-2",
      source: "history",
      hydratedCount: 0,
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

    await expect(session.exitGroup()).resolves.toMatchObject({
      ok: true,
      groupId: "group-2",
    });
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());
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
    await applyPostToolEffects(context, await session.flushPendingPostToolEffects());

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
