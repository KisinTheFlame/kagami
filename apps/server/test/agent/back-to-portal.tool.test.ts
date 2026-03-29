import { describe, expect, it } from "vitest";
import { BackToPortalTool } from "../../src/agent/runtime/root-agent/tools/back-to-portal.tool.js";

describe("back_to_portal tool", () => {
  it("should return state transition error when current state is portal", async () => {
    const tool = new BackToPortalTool();
    const toolContext = {
      rootAgentSession: {
        exitGroup: async () => ({
          ok: false,
          error: "STATE_TRANSITION_NOT_ALLOWED",
        }),
      },
    } as Parameters<typeof tool.execute>[1];

    const result = await tool.execute({}, toolContext);

    expect(tool.name).toBe("back_to_portal");
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "STATE_TRANSITION_NOT_ALLOWED",
    });
  });
});
