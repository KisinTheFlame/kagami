import { describe, expect, it } from "vitest";
import { BackTool } from "../../src/agent/runtime/root-agent/tools/back-to-portal.tool.js";

describe("back tool", () => {
  it("should return state transition error when current state is root", async () => {
    const tool = new BackTool();
    const toolContext = {
      rootAgentSession: {
        back: async () => ({
          ok: false,
          error: "STATE_TRANSITION_NOT_ALLOWED",
        }),
      },
    } as Parameters<typeof tool.execute>[1];

    const result = await tool.execute({}, toolContext);

    expect(tool.name).toBe("back");
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "STATE_TRANSITION_NOT_ALLOWED",
    });
  });
});
