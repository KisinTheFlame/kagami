import { AppManager, type App } from "@kagami/agent-runtime";
import { describe, expect, it } from "vitest";
import { EnterTool } from "../../src/agent/runtime/root-agent/tools/enter.tool.js";

function createFakeApp(id: string): App {
  return {
    id,
    displayName: id,
    tools: [],
    canInvoke: () => true,
    help: async () => `you are in ${id}`,
  };
}

describe("enter tool", () => {
  it("should reject a non-App id (chat state tree retired)", async () => {
    const tool = new EnterTool({ appManager: new AppManager() });
    const result = await tool.execute({ id: "qq_group:group-1" }, {
      rootAgentSession: {
        getCurrentApp: () => undefined,
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(tool.name).toBe("enter");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "ENTER_TARGET_NOT_AVAILABLE",
    });
  });

  it("should reject missing id", async () => {
    const tool = new EnterTool({ appManager: new AppManager() });
    const result = await tool.execute({}, {});

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });

  it("should enter App and emit switch_app effect when id matches a registered App", async () => {
    const appManager = new AppManager();
    appManager.register(createFakeApp("calc"));
    const tool = new EnterTool({ appManager });

    const result = await tool.execute({ id: "calc" }, {
      rootAgentSession: {
        enter: async () => {
          throw new Error("should not delegate to state tree when id matches an App");
        },
        getCurrentApp: () => undefined,
        setCurrentApp: () => {
          throw new Error("EnterTool must not call setCurrentApp directly; goes through effects");
        },
      },
    } as Parameters<typeof tool.execute>[1]);

    // Effect 模型下 EnterTool 不直接调 session.setCurrentApp，而是产
    // switch_app Effect 让 Interpreter 应用。createFakeApp 没有 onFocus，所以
    // effects 数组只有 switch_app。
    expect(result.effects).toEqual([{ type: "switch_app", appId: "calc" }]);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      type: "app",
      enteredApp: "calc",
    });
  });

  it("should reject entering App when already in another App", async () => {
    const appManager = new AppManager();
    appManager.register(createFakeApp("calc"));
    const tool = new EnterTool({ appManager });

    const result = await tool.execute({ id: "calc" }, {
      rootAgentSession: {
        enter: async () => {
          throw new Error("should not delegate to state tree");
        },
        getCurrentApp: () => "another",
        setCurrentApp: () => {},
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "ALREADY_IN_APP",
    });
  });
});
