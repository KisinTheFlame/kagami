import { describe, expect, it } from "vitest";
import { SleepTool } from "../../src/agent/runtime/root-agent/tools/sleep.tool.js";

describe("sleep tool", () => {
  it("should request portal sleep with configured duration", async () => {
    const tool = new SleepTool({
      sleepMs: 30_000,
    });

    const result = await tool.execute({}, {});

    expect(tool.name).toBe("sleep");
    expect(result).toEqual({
      content: "",
      signal: "sleep",
      sleepMs: 30_000,
    });
  });
});
