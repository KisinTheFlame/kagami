import { describe, expect, it } from "vitest";
import type { LlmMessage, LlmToolCall } from "@kagami/llm-client";
import { WaitTool } from "../../src/agent/runtime/root-agent/tools/wait.tool.js";

function makeToolCall(name: string, id = `${name}-${Math.random()}`): LlmToolCall {
  return { id, name, arguments: {} };
}

function assistantWith(...toolCalls: LlmToolCall[]): LlmMessage {
  return { role: "assistant", content: "", toolCalls };
}

function toolResult(toolCallId: string, content = "ok"): LlmMessage {
  return { role: "tool", toolCallId, content };
}

function createWaitTool(): WaitTool {
  return new WaitTool({ maxWaitMs: 1_000 });
}

function executeWait(tool: WaitTool, messages: LlmMessage[]): ReturnType<WaitTool["execute"]> {
  return tool.execute(
    {},
    {
      messages,
      systemPrompt: "test",
    },
  );
}

describe("WaitTool", () => {
  it("produces wait_for_event Effect", async () => {
    const tool = createWaitTool();
    const result = await executeWait(tool, []);

    expect(result.effects).toEqual([{ type: "wait_for_event", maxWaitMs: 1_000 }]);
    expect(result.content).toBe("休息结束了");
  });

  it("still produces wait_for_event Effect after repeated waits", async () => {
    const tool = createWaitTool();
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("wait", "t1")),
      toolResult("t1", "休息结束了"),
      assistantWith(makeToolCall("wait", "t2")),
      toolResult("t2", "休息结束了"),
      assistantWith(makeToolCall("wait", "t3")),
    ];
    const result = await executeWait(tool, messages);

    expect(result.effects).toEqual([{ type: "wait_for_event", maxWaitMs: 1_000 }]);
    expect(result.content).toBe("休息结束了");
  });
});
