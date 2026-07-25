import { describe, expect, it } from "vitest";
import { toClaudeCodeRequestBody } from "../src/providers/claude-code-request.js";
import type { LlmChatRequest } from "../src/types.js";

// max_tokens 是「thinking + 正文」的合计硬顶：机型漏判会静默回落 4096，
// 开着 adaptive thinking 时思考吃掉配额、正文中途截断。换主力机型时钉死这条。

function createChatRequest(model: string): LlmChatRequest {
  return {
    system: "你是一个测试助手。",
    messages: [{ role: "user", content: "ping" }],
    tools: [],
    toolChoice: "auto",
    model,
  };
}

describe("claude-code max_tokens", () => {
  it.each([
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
  ])("should give %s the large output budget", model => {
    expect(toClaudeCodeRequestBody(createChatRequest(model)).max_tokens).toBe(32000);
  });

  it("should fall back to the conservative budget for other models", () => {
    expect(toClaudeCodeRequestBody(createChatRequest("claude-haiku-4-5")).max_tokens).toBe(4096);
  });
});
