import { AppManager, type App } from "@kagami/agent-runtime";
import { describe, expect, it } from "vitest";
import { SwitchTool } from "../../src/agent/runtime/root-agent/tools/switch.tool.js";

function createFakeApp(
  id: string,
  hooks: { onFocusEffects?: readonly unknown[]; onBlurEffects?: readonly unknown[] } = {},
): App {
  return {
    id,
    displayName: id,
    tools: [],
    canInvoke: () => true,
    help: async () => `you are in ${id}`,
    onFocus: async () => (hooks.onFocusEffects ?? []) as never,
    onBlur: async () => (hooks.onBlurEffects ?? []) as never,
  };
}

describe("switch tool", () => {
  it("should switch App A -> App B emitting onBlur, switch_app, onFocus in order", async () => {
    const appManager = new AppManager();
    appManager.register(
      createFakeApp("calc", { onBlurEffects: [{ type: "append_message", content: "bye calc" }] }),
    );
    appManager.register(
      createFakeApp("hn", { onFocusEffects: [{ type: "append_message", content: "hi hn" }] }),
    );
    const tool = new SwitchTool({ appManager });

    const result = await tool.execute({ id: "hn" }, {
      rootAgentSession: {
        getCurrentApp: () => "calc",
        setCurrentApp: () => {
          throw new Error("SwitchTool must not call setCurrentApp directly; goes through effects");
        },
      },
    } as Parameters<typeof tool.execute>[1]);

    // Effect 模型：先源 App.onBlur，再 switch_app 切焦点，再目标 App.onFocus。
    expect(result.effects).toEqual([
      { type: "append_message", content: "bye calc" },
      { type: "switch_app", appId: "hn" },
      { type: "append_message", content: "hi hn" },
    ]);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      fromApp: "calc",
      toApp: "hn",
    });
  });

  it("should enter the target App from Portal with no source (no onBlur)", async () => {
    const appManager = new AppManager();
    appManager.register(
      createFakeApp("hn", { onFocusEffects: [{ type: "append_message", content: "hi hn" }] }),
    );
    const tool = new SwitchTool({ appManager });

    const result = await tool.execute({ id: "hn" }, {
      rootAgentSession: {
        getCurrentApp: () => undefined,
        setCurrentApp: () => {
          throw new Error("SwitchTool must not call setCurrentApp directly; goes through effects");
        },
      },
    } as Parameters<typeof tool.execute>[1]);

    // 从 Portal 进入：没有源 App，故不跑 onBlur，只有 switch_app + 目标 onFocus。
    expect(result.effects).toEqual([
      { type: "switch_app", appId: "hn" },
      { type: "append_message", content: "hi hn" },
    ]);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      fromApp: null,
      toApp: "hn",
    });
  });

  it("should reject an unknown target App id", async () => {
    const appManager = new AppManager();
    appManager.register(createFakeApp("calc"));
    const tool = new SwitchTool({ appManager });

    const result = await tool.execute({ id: "nope" }, {
      rootAgentSession: { getCurrentApp: () => "calc" },
    } as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "SWITCH_TARGET_NOT_AVAILABLE",
    });
    expect(result.effects).toBeUndefined();
  });

  it("should reject switching to the App you are already in", async () => {
    const appManager = new AppManager();
    appManager.register(createFakeApp("calc"));
    const tool = new SwitchTool({ appManager });

    const result = await tool.execute({ id: "calc" }, {
      rootAgentSession: { getCurrentApp: () => "calc" },
    } as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "ALREADY_IN_TARGET_APP",
    });
    expect(result.effects).toBeUndefined();
  });

  it("should reject missing id", async () => {
    const tool = new SwitchTool({ appManager: new AppManager() });
    const result = await tool.execute({}, {});

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });
});
