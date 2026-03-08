import { describe, expect, it } from "vitest";
import { finishTool } from "../../src/agent/tools/finish.js";

describe("finish tool", () => {
  it("should mark the current round as finished", async () => {
    const result = await finishTool.execute({});

    expect(finishTool.tool.name).toBe("finish");
    expect(result).toEqual({
      content: JSON.stringify({ finished: true }),
      shouldFinishRound: true,
    });
  });
});
