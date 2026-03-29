import { describe, expect, it } from "vitest";
import { SleepTool } from "../../src/agent/runtime/root-agent/tools/sleep.tool.js";

describe("sleep tool", () => {
  it("should request portal sleep with configured duration", async () => {
    const tool = new SleepTool({
      sleepMs: 30_000,
    });
    const toolContext = {
      rootAgentSession: {
        getState: () => ({ kind: "portal" as const }),
      },
    } as Parameters<typeof tool.execute>[1];

    const result = await tool.execute({}, toolContext);

    expect(tool.name).toBe("sleep");
    expect(result).toEqual({
      content: "",
      signal: "sleep",
      sleepMs: 30_000,
    });
  });

  it("should reject sleep outside portal state", async () => {
    const tool = new SleepTool({
      sleepMs: 30_000,
    });
    const toolContext = {
      rootAgentSession: {
        getState: () => ({ kind: "group" as const, groupId: "group-1" }),
      },
    } as Parameters<typeof tool.execute>[1];

    const result = await tool.execute({}, toolContext);

    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "STATE_TRANSITION_NOT_ALLOWED",
    });
  });
});
