import { describe, expect, it } from "vitest";
import { AppManager, type App } from "@kagami/agent-runtime";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

function createTestApp(id: string, displayName: string): App {
  return { id, displayName, tools: [], canInvoke: () => true, help: async () => "" };
}

function createContext() {
  return new DefaultAgentContext({ systemPromptFactory: () => "system-prompt" });
}

describe("RootAgentSession (App 启动器)", () => {
  it("initializes with a portal reminder (app 名单已移到 system prompt，reminder 不再逐条列)", async () => {
    const context = createContext();
    const appManager = new AppManager();
    appManager.register(createTestApp("qq", "QQ"));
    const session = new RootAgentSession({ context, appManager });

    await session.initializeContext();

    const snapshot = await context.getSnapshot();
    const reminder = snapshot.messages.at(-1);
    expect(reminder?.content).toContain("<system_reminder>");
    expect(reminder?.content).toContain("桌面（Portal）");
    // App 名单常驻 system prompt，Portal 提醒只给导航说明，不再逐条列 App。
    const content = typeof reminder?.content === "string" ? reminder.content : "";
    expect(content).not.toContain("- qq：QQ");
    expect(content).toContain("switch(id=...)");
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

  it("does not trigger a round on wake", async () => {
    const context = createContext();
    const session = new RootAgentSession({ context, appManager: new AppManager() });
    await session.initializeContext();

    const wake = await session.consumeIncomingEvent({ type: "wake" });
    expect(wake).toEqual({ shouldTriggerRound: false });
  });

  it("markRestored marks context initialized so the portal reminder is not re-appended", async () => {
    const context = createContext();
    const appManager = new AppManager();
    appManager.register(createTestApp("qq", "QQ"));
    const session = new RootAgentSession({ context, appManager });

    // 模拟恢复路径：上下文已含上一会话的 portal reminder（这里用一条占位消息代表旧前缀）。
    await context.appendMessages([{ role: "user", content: "restored-prefix" }]);
    session.markRestored();

    await session.initializeContext();

    const snapshot = await context.getSnapshot();
    const portalReminders = snapshot.messages.filter(
      message => typeof message.content === "string" && message.content.includes("桌面（Portal）"),
    );
    expect(portalReminders).toHaveLength(0);
  });

  it("reset re-enables initialization so the portal reminder is re-appended", async () => {
    const context = createContext();
    const appManager = new AppManager();
    appManager.register(createTestApp("qq", "QQ"));
    const session = new RootAgentSession({ context, appManager });

    await session.initializeContext();
    session.reset();
    // reset 把 initialized 置回 false（与 markRestored 相反）：下一次 initializeContext 必须
    // 重新追加 portal reminder。配合上下文 reset 一起用，重建稳定前缀。
    await session.initializeContext();

    const snapshot = await context.getSnapshot();
    const portalReminders = snapshot.messages.filter(
      message => typeof message.content === "string" && message.content.includes("桌面（Portal）"),
    );
    expect(portalReminders).toHaveLength(2);
  });

  it("tracks the current app", () => {
    const session = new RootAgentSession({
      context: createContext(),
      appManager: new AppManager(),
    });
    expect(session.getCurrentApp()).toBeUndefined();
    session.setCurrentApp("qq");
    expect(session.getCurrentApp()).toBe("qq");
    // Portal 离开后不可返回；只有 reset() 能把 currentApp 归位到初始状态。
    session.reset();
    expect(session.getCurrentApp()).toBeUndefined();
  });

  it("getCurrentStateTag：挂起→wait；活跃在某 App→appId；未进任何 App→portal（互斥单轴）", () => {
    const session = new RootAgentSession({
      context: createContext(),
      appManager: new AppManager(),
    });

    // 初始未进任何 App = portal。
    expect(session.getCurrentStateTag()).toBe("portal");

    // 进入 App = appId。
    session.setCurrentApp("browser");
    expect(session.getCurrentStateTag()).toBe("browser");

    // 挂起盖过所在 App = wait。
    session.setSuspended(true);
    expect(session.getCurrentStateTag()).toBe("wait");

    // 唤醒后回到所在 App。
    session.setSuspended(false);
    expect(session.getCurrentStateTag()).toBe("browser");

    // reset 归位：suspended 清位 + currentApp 清空 → portal。
    session.setSuspended(true);
    session.reset();
    expect(session.getCurrentStateTag()).toBe("portal");
  });

  it("markRestored 归位挂起标志（重启后主循环从活跃态重放，不残留 wait）", () => {
    const session = new RootAgentSession({
      context: createContext(),
      appManager: new AppManager(),
    });
    session.setSuspended(true);
    session.markRestored();
    expect(session.getCurrentStateTag()).toBe("portal");
  });

  it("tracks entered apps and clears them on clearEnteredApps", () => {
    const session = new RootAgentSession({
      context: createContext(),
      appManager: new AppManager(),
    });
    expect(session.hasEnteredApp("qq")).toBe(false);
    session.markAppEntered("qq");
    expect(session.hasEnteredApp("qq")).toBe(true);
    expect(session.hasEnteredApp("calc")).toBe(false);
    // 压缩边界：clearEnteredApps 让压缩后首进重新吐 help。
    session.clearEnteredApps();
    expect(session.hasEnteredApp("qq")).toBe(false);
  });

  it("clears entered apps on reset and markRestored", () => {
    const session = new RootAgentSession({
      context: createContext(),
      appManager: new AppManager(),
    });

    session.markAppEntered("qq");
    session.reset();
    expect(session.hasEnteredApp("qq")).toBe(false);

    session.markAppEntered("hn");
    session.markRestored();
    expect(session.hasEnteredApp("hn")).toBe(false);
  });
});
