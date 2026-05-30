import { describe, expect, it } from "vitest";
import type { LlmMessage, LlmToolCall } from "../../src/llm/types.js";
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
  it("produces wait_for_event Effect with the configured maxWaitMs", async () => {
    const tool = createWaitTool();
    const result = await executeWait(tool, []);
    // Effect 模型阶段 6：工具自己不阻塞，产 wait_for_event Effect 让 Interpreter 接管。
    expect(result.effects).toEqual([{ type: "wait_for_event", maxWaitMs: 1_000 }]);
    expect(result.content).toBe("休息结束了");
  });

  it("produces wait_for_event Effect even after many consecutive waits", async () => {
    const tool = createWaitTool();
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("wait", "t1")),
      toolResult("t1", "休息结束了"),
      assistantWith(makeToolCall("wait", "t2")),
      toolResult("t2", "休息结束了"),
      assistantWith(makeToolCall("wait", "t3")),
      toolResult("t3", "休息结束了"),
    ];
    const result = await executeWait(tool, messages);
    // 连续调用短路防御已删除：无论历史里有多少次连续 wait，本次仍正常产 Effect。
    expect(result.effects).toEqual([{ type: "wait_for_event", maxWaitMs: 1_000 }]);
    expect(result.content).toBe("休息结束了");
  });
});
