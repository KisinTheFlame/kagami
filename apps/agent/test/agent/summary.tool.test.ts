import { describe, expect, it } from "vitest";
import { TERMINATE_EFFECT_TYPE } from "@kagami/agent-runtime";
import { FinalizeSummaryTool } from "../../src/agent/capabilities/context-summary/task-agent/tools/finalize-summary.tool.js";

describe("finalize_summary tool", () => {
  it("should return the summary and a terminate effect", async () => {
    const tool = new FinalizeSummaryTool();

    await expect(tool.execute({ summary: "  需要保留的摘要  " }, {})).resolves.toEqual({
      content: "需要保留的摘要",
      effects: [{ type: TERMINATE_EFFECT_TYPE, content: "需要保留的摘要" }],
    });
  });

  it("should reject empty summary without terminating", async () => {
    const tool = new FinalizeSummaryTool();

    const result = await tool.execute({ summary: "" }, {});
    expect(result.effects ?? []).toEqual([]);
  });
});
