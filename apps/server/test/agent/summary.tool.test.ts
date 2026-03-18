import { describe, expect, it } from "vitest";
import { SummaryTool } from "../../src/tools/index.js";

describe("summary tool", () => {
  it("should return the provided summary string", async () => {
    const tool = new SummaryTool();

    await expect(tool.execute({ summary: "  需要保留的摘要  " }, {})).resolves.toEqual({
      content: "需要保留的摘要",
      signal: "continue",
    });
  });

  it("should return an empty string when arguments are invalid", async () => {
    const tool = new SummaryTool();

    await expect(tool.execute({ summary: "" }, {})).resolves.toEqual({
      content: "",
      signal: "continue",
    });
  });
});
