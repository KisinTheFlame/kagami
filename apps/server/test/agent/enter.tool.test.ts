import { AppManager, type App } from "@kagami/agent-runtime";
import { describe, expect, it } from "vitest";
import { EnterTool } from "../../src/agent/runtime/root-agent/tools/enter.tool.js";

function createFakeApp(id: string): App {
  return {
    id,
    tools: [],
    canInvoke: () => true,
    help: async () => `you are in ${id}`,
  };
}

describe("enter tool", () => {
  it("should enter child state by id when not an App", async () => {
    const tool = new EnterTool({ appManager: new AppManager() });
    const result = await tool.execute(
      {
        id: "qq_group:group-1",
      },
      {
        rootAgentSession: {
          enter: async (input: { id: string }) => ({
            ok: true,
            ...input,
            displayName: "QQ 群 产品群 (group-1)",
            message: "已进入QQ 群 产品群 (group-1)",
          }),
          getFocusedStateId: () => "portal",
          getCurrentApp: () => undefined,
          setCurrentApp: () => {},
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(tool.name).toBe("enter");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      id: "qq_group:group-1",
      displayName: "QQ 群 产品群 (group-1)",
      message: "已进入QQ 群 产品群 (group-1)",
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

  it("should enter App and set currentApp when id matches a registered App", async () => {
    const appManager = new AppManager();
    appManager.register(createFakeApp("calc"));
    const tool = new EnterTool({ appManager });

    const setCurrentAppCalls: string[] = [];
    const result = await tool.execute({ id: "calc" }, {
      rootAgentSession: {
        enter: async () => {
          throw new Error("should not delegate to state tree when id matches an App");
        },
        getFocusedStateId: () => "portal",
        getCurrentApp: () => undefined,
        setCurrentApp: (id: string) => {
          setCurrentAppCalls.push(id);
        },
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(setCurrentAppCalls).toEqual(["calc"]);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      type: "app",
      enteredApp: "calc",
    });
  });

  it("should reject entering App when not at portal", async () => {
    const appManager = new AppManager();
    appManager.register(createFakeApp("calc"));
    const tool = new EnterTool({ appManager });

    const result = await tool.execute({ id: "calc" }, {
      rootAgentSession: {
        enter: async () => {
          throw new Error("should not delegate to state tree");
        },
        getFocusedStateId: () => "qq_group:123",
        getCurrentApp: () => undefined,
        setCurrentApp: () => {},
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "MUST_BE_AT_PORTAL",
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
        getFocusedStateId: () => "portal",
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
