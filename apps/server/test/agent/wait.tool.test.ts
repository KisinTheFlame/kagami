import { describe, expect, it, vi } from "vitest";
import type { LlmMessage, LlmToolCall } from "../../src/llm/types.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import {
  CONSECUTIVE_WAIT_BLOCK_THRESHOLD,
  WaitTool,
  countTrailingWaitToolCalls,
} from "../../src/agent/runtime/root-agent/tools/wait.tool.js";

function makeToolCall(name: string, id = `${name}-${Math.random()}`): LlmToolCall {
  return { id, name, arguments: {} };
}

function assistantWith(...toolCalls: LlmToolCall[]): LlmMessage {
  return { role: "assistant", content: "", toolCalls };
}

function toolResult(toolCallId: string, content = "ok"): LlmMessage {
  return { role: "tool", toolCallId, content };
}

function userMessage(content = "ping"): LlmMessage {
  return { role: "user", content };
}

function createWaitTool(): {
  tool: WaitTool;
  waitNonEmpty: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
} {
  const waitNonEmpty = vi.fn(async () => {});
  const enqueue = vi.fn();
  const eventQueue = {
    waitNonEmpty,
    enqueue,
  } as unknown as AgentEventQueue;
  const tool = new WaitTool({ eventQueue, maxWaitMs: 1_000 });
  return { tool, waitNonEmpty, enqueue };
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

describe("countTrailingWaitToolCalls", () => {
  it("returns 0 for empty messages", () => {
    expect(countTrailingWaitToolCalls([])).toBe(0);
  });

  it("returns 0 when last assistant call is not wait", () => {
    const messages: LlmMessage[] = [assistantWith(makeToolCall("invoke", "t1"))];
    expect(countTrailingWaitToolCalls(messages)).toBe(0);
  });

  it("counts a single trailing wait", () => {
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("invoke", "t1")),
      toolResult("t1"),
      assistantWith(makeToolCall("wait", "t2")),
      toolResult("t2", "休息结束了"),
    ];
    expect(countTrailingWaitToolCalls(messages)).toBe(1);
  });

  it("counts two trailing waits across separate assistant turns", () => {
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("invoke", "t1")),
      toolResult("t1"),
      assistantWith(makeToolCall("wait", "t2")),
      toolResult("t2", "休息结束了"),
      assistantWith(makeToolCall("wait", "t3")),
      toolResult("t3", "休息结束了"),
    ];
    expect(countTrailingWaitToolCalls(messages)).toBe(2);
  });

  it("ignores user messages and tool results when counting", () => {
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("wait", "t1")),
      toolResult("t1", "休息结束了"),
      userMessage("新消息进来"),
      assistantWith(makeToolCall("wait", "t2")),
      toolResult("t2", "休息结束了"),
    ];
    expect(countTrailingWaitToolCalls(messages)).toBe(2);
  });

  it("stops at the first non-wait tool call from the tail", () => {
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("wait", "t1")),
      toolResult("t1"),
      assistantWith(makeToolCall("invoke", "t2")),
      toolResult("t2"),
      assistantWith(makeToolCall("wait", "t3")),
      toolResult("t3"),
    ];
    expect(countTrailingWaitToolCalls(messages)).toBe(1);
  });

  it("treats an assistant turn with no tool calls as a break", () => {
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("wait", "t1")),
      toolResult("t1"),
      { role: "assistant", content: "随便说一句", toolCalls: [] },
      assistantWith(makeToolCall("wait", "t2")),
      toolResult("t2"),
    ];
    expect(countTrailingWaitToolCalls(messages)).toBe(1);
  });
});

describe("WaitTool", () => {
  it("threshold is 3", () => {
    expect(CONSECUTIVE_WAIT_BLOCK_THRESHOLD).toBe(3);
  });

  it("blocks on eventQueue when no prior wait exists (first wait)", async () => {
    const { tool, waitNonEmpty } = createWaitTool();
    const result = await executeWait(tool, []);
    expect(waitNonEmpty).toHaveBeenCalledOnce();
    expect(result.content).toBe("休息结束了");
  });

  it("blocks on eventQueue on the 2nd consecutive wait", async () => {
    const { tool, waitNonEmpty } = createWaitTool();
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("wait", "t1")),
      toolResult("t1", "休息结束了"),
    ];
    const result = await executeWait(tool, messages);
    expect(waitNonEmpty).toHaveBeenCalledOnce();
    expect(result.content).toBe("休息结束了");
  });

  it("short-circuits on the 3rd consecutive wait without blocking", async () => {
    const { tool, waitNonEmpty, enqueue } = createWaitTool();
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("wait", "t1")),
      toolResult("t1", "休息结束了"),
      assistantWith(makeToolCall("wait", "t2")),
      toolResult("t2", "休息结束了"),
    ];
    const result = await executeWait(tool, messages);
    expect(waitNonEmpty).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(result.content).toContain("<wait_blocked>");
    expect(result.content).toContain("3");
  });

  it("still short-circuits if waits are interleaved with napcat user messages", async () => {
    const { tool, waitNonEmpty } = createWaitTool();
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("wait", "t1")),
      toolResult("t1", "休息结束了"),
      userMessage("外部刺激"),
      assistantWith(makeToolCall("wait", "t2")),
      toolResult("t2", "休息结束了"),
      userMessage("再来一条"),
    ];
    const result = await executeWait(tool, messages);
    expect(waitNonEmpty).not.toHaveBeenCalled();
    expect(result.content).toContain("<wait_blocked>");
  });

  it("does not short-circuit when a non-wait tool call breaks the streak", async () => {
    const { tool, waitNonEmpty } = createWaitTool();
    const messages: LlmMessage[] = [
      assistantWith(makeToolCall("wait", "t1")),
      toolResult("t1", "休息结束了"),
      assistantWith(makeToolCall("invoke", "t2")),
      toolResult("t2"),
      assistantWith(makeToolCall("wait", "t3")),
      toolResult("t3", "休息结束了"),
    ];
    const result = await executeWait(tool, messages);
    expect(waitNonEmpty).toHaveBeenCalledOnce();
    expect(result.content).toBe("休息结束了");
  });
});
