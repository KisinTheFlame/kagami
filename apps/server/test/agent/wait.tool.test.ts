import { describe, expect, it, vi } from "vitest";
import { WaitTool } from "../../src/agent/runtime/root-agent/tools/wait.tool.js";

describe("wait tool", () => {
  it("should enter waiting state and finish current round", async () => {
    const now = new Date("2026-03-30T10:00:00.000Z");
    const tool = new WaitTool({
      now: () => now,
    });
    const wait = vi.fn().mockResolvedValue({
      ok: true,
      deadlineAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    });

    const result = await tool.execute({}, {
      rootAgentSession: {
        wait,
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(wait).toHaveBeenCalledWith({
      deadlineAt: new Date(now.getTime() + 5 * 60 * 1000),
    });
    expect(tool.name).toBe("wait");
    expect(result.signal).toBe("finish_round");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
    });
  });

  it("should reject wait outside portal state", async () => {
    const tool = new WaitTool();

    const result = await tool.execute({}, {
      rootAgentSession: {
        wait: async () => ({
          ok: false,
          error: "STATE_TRANSITION_NOT_ALLOWED",
        }),
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "STATE_TRANSITION_NOT_ALLOWED",
    });
  });
});
