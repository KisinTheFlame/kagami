import { AppManager, type App } from "@kagami/agent-runtime";
import { describe, expect, it } from "vitest";
import { BackToPortalTool } from "../../src/agent/runtime/root-agent/tools/back-to-portal.tool.js";

function createFakeApp(id: string, onBlurEffects: readonly unknown[] = []): App {
  return {
    id,
    displayName: id,
    tools: [],
    canInvoke: () => true,
    help: async () => `you are in ${id}`,
    onBlur: async () => onBlurEffects as never,
  };
}

describe("back_to_portal tool", () => {
  it("should emit switch_app{null} effect and report exit when in an App", async () => {
    const appManager = new AppManager();
    appManager.register(createFakeApp("calc"));
    const tool = new BackToPortalTool({ appManager });

    const result = await tool.execute({}, {
      rootAgentSession: {
        getCurrentApp: () => "calc",
        clearCurrentApp: () => {
          throw new Error("BackToPortalTool must not call clearCurrentApp directly");
        },
      },
    } as Parameters<typeof tool.execute>[1]);

    // 没注册 onBlur 钩子，effects 只含 switch_app{null}。
    expect(result.effects).toEqual([{ type: "switch_app", appId: null }]);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      exitedApp: "calc",
    });
  });

  it("should reject when not in any App", async () => {
    const appManager = new AppManager();
    const tool = new BackToPortalTool({ appManager });
    const result = await tool.execute({}, {
      rootAgentSession: {
        getCurrentApp: () => undefined,
        clearCurrentApp: () => {
          throw new Error("should not be called when not in App");
        },
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "NOT_IN_APP",
    });
    expect(result.effects).toBeUndefined();
  });
});
