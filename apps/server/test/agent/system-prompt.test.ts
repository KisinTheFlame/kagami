import { describe, expect, it } from "vitest";
import { createAgentSystemPrompt } from "../../src/agent/runtime/root-agent/system-prompt.js";

describe("createAgentSystemPrompt", () => {
  it("should describe qq message and system tags in the prompt", () => {
    const prompt = createAgentSystemPrompt({
      botQQ: "123456789",
      creatorName: "测试创造者",
      creatorQQ: "987654321",
    });

    expect(prompt).toContain("<input_format>");
    expect(prompt).toContain("<qq_message>");
    expect(prompt).toContain("<system_reminder>");
    expect(prompt).toContain("<system_instruction>");
    expect(prompt).toContain("<conversation_summary>");
    expect(prompt).toContain("123456789");
    expect(prompt).toContain("测试创造者");
    expect(prompt).toContain("987654321");
  });
});
