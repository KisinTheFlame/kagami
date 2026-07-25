import { describe, expect, it } from "vitest";
import { toClaudeCodeRequestBody } from "../src/providers/claude-code-request.js";
import type { LlmChatRequest } from "../src/types.js";

// max_tokens 不按机型分档：换主力机型不该再牵动这里。曾经的代际分档会让新机型静默降到
// 4096，而 max_tokens 是「thinking + 正文」的合计硬顶，表现为正文中途截断、极难归因。

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
    "claude-haiku-4-5",
    "claude-some-future-model",
  ])("should send the same budget regardless of model (%s)", model => {
    expect(toClaudeCodeRequestBody(createChatRequest(model)).max_tokens).toBe(32000);
  });
});
