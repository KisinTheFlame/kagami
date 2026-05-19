import { describe, expect, it } from "vitest";
import { BackToPortalTool } from "../../src/agent/runtime/root-agent/tools/back-to-portal.tool.js";

describe("back_to_portal tool", () => {
  it("should clear currentApp and report exit when in an App", async () => {
    const tool = new BackToPortalTool();
    const clearCalls: number[] = [];
    const result = await tool.execute({}, {
      rootAgentSession: {
        getCurrentApp: () => "calc",
        clearCurrentApp: () => {
          clearCalls.push(1);
        },
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(clearCalls).toHaveLength(1);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      exitedApp: "calc",
    });
  });

  it("should reject when not in any App", async () => {
    const tool = new BackToPortalTool();
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
  });
});
