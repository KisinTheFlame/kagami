import { describe, expect, it } from "vitest";
import { AppManager, type App } from "@kagami/agent-runtime";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import type { NapcatChatTarget } from "../../src/napcat/service/napcat-gateway.service.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

function createTestApp(id: string, displayName: string): App {
  return { id, displayName, tools: [], canInvoke: () => true, help: async () => "" };
}

function createContext() {
  return new DefaultAgentContext({ systemPromptFactory: () => "system-prompt" });
}

describe("RootAgentSession (App 启动器)", () => {
  it("initializes with a portal reminder listing registered apps", async () => {
    const context = createContext();
    const appManager = new AppManager();
    appManager.register(createTestApp("qq", "QQ"));
    const session = new RootAgentSession({ context, appManager });

    await session.initializeContext();

    const snapshot = await context.getSnapshot();
    const reminder = snapshot.messages.at(-1);
    expect(reminder?.content).toContain("<system_reminder>");
    expect(reminder?.content).toContain("桌面（Portal）");
    expect(typeof reminder?.content === "string" ? reminder.content : "").toContain("QQ");
    expect(session.getState()).toEqual({ focusedStateId: "portal", stateStack: ["portal"] });
  });

  it("appends a <notification> message and triggers a round on notification events", async () => {
    const context = createContext();
    const session = new RootAgentSession({ context, appManager: new AppManager() });
    await session.initializeContext();

    const consumeResult = await session.consumeIncomingEvent({
      type: "notification",
      data: { lines: ["IT之家：2篇新文，最新《某标题》", "产品群：[有人@你] 在吗"] },
    });
    const flushResult = await session.flushPendingIncomingEffects();

    expect(consumeResult).toEqual({ shouldTriggerRound: true });
    expect(flushResult).toEqual({ shouldTriggerRound: true });

    const snapshot = await context.getSnapshot();
    const notification = snapshot.messages.find(
      message => typeof message.content === "string" && message.content.includes("<notification>"),
    );
    expect(notification?.content).toContain("产品群：[有人@你] 在吗");
  });

  it("triggers a round on story_recall but not on wake", async () => {
    const context = createContext();
    const session = new RootAgentSession({ context, appManager: new AppManager() });
    await session.initializeContext();

    const story = await session.consumeIncomingEvent({
      type: "story_recall_completed",
      data: { stories: [{ id: "s1", markdown: "回忆", createdAt: new Date(0) }] },
    });
    expect(story).toEqual({ shouldTriggerRound: true });

    const wake = await session.consumeIncomingEvent({ type: "wake" });
    expect(wake).toEqual({ shouldTriggerRound: false });
  });

  it("delegates getCurrentChatTarget to the chat target provider (QQ App current conversation)", async () => {
    const holder: { target: NapcatChatTarget | undefined } = { target: undefined };
    const session = new RootAgentSession({
      context: createContext(),
      appManager: new AppManager(),
      chatTargetProvider: () => holder.target,
    });

    expect(session.getCurrentChatTarget()).toBeUndefined();
    holder.target = { chatType: "group", groupId: "group-1" };
    expect(session.getCurrentChatTarget()).toEqual({ chatType: "group", groupId: "group-1" });
    expect(session.getCurrentGroupId()).toBe("group-1");
  });

  it("tracks the current app", () => {
    const session = new RootAgentSession({
      context: createContext(),
      appManager: new AppManager(),
    });
    expect(session.getCurrentApp()).toBeUndefined();
    session.setCurrentApp("qq");
    expect(session.getCurrentApp()).toBe("qq");
    session.clearCurrentApp();
    expect(session.getCurrentApp()).toBeUndefined();
  });
});
