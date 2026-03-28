import { describe, expect, it } from "vitest";
import { FinishTool } from "../../src/agent/runtime/root-agent/tools/finish.tool.js";

describe("finish tool", () => {
  it("should mark the current round as finished", async () => {
    const tool = new FinishTool();
    const result = await tool.execute({}, {});

    expect(tool.name).toBe("finish");
    expect(result).toEqual({
      content: "",
      signal: "finish_round",
    });
  });
});
