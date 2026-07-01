import { AppManager, type App } from "@kagami/agent-runtime";
import { describe, expect, it } from "vitest";
import { ListAppsTool } from "../../src/agent/runtime/root-agent/tools/list-apps.tool.js";

function createFakeApp(id: string, displayName: string): App {
  return {
    id,
    displayName,
    tools: [],
    canInvoke: () => true,
    help: async () => `you are in ${id}`,
  };
}

function makeManager(): AppManager {
  const appManager = new AppManager();
  appManager.register(createFakeApp("calc", "计算器"));
  appManager.register(createFakeApp("hn", "Hacker News"));
  return appManager;
}

describe("list_apps tool", () => {
  it("should list every App with no current marker when on Portal", async () => {
    const tool = new ListAppsTool({ appManager: makeManager() });

    const result = await tool.execute({}, {
      rootAgentSession: { getCurrentApp: () => undefined },
    } as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toEqual({
      ok: true,
      currentApp: null,
      apps: [
        { id: "calc", displayName: "计算器", current: false },
        { id: "hn", displayName: "Hacker News", current: false },
      ],
    });
  });

  it("should mark the current App when inside one", async () => {
    const tool = new ListAppsTool({ appManager: makeManager() });

    const result = await tool.execute({}, {
      rootAgentSession: { getCurrentApp: () => "hn" },
    } as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toEqual({
      ok: true,
      currentApp: "hn",
      apps: [
        { id: "calc", displayName: "计算器", current: false },
        { id: "hn", displayName: "Hacker News", current: true },
      ],
    });
  });

  it("should tolerate a missing rootAgentSession (treat as Portal)", async () => {
    const tool = new ListAppsTool({ appManager: makeManager() });

    const result = await tool.execute({}, {} as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toMatchObject({ ok: true, currentApp: null });
  });
});
