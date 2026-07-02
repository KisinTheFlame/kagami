import { describe, expect, it, vi } from "vitest";
import { ToolCatalog } from "@kagami/agent-runtime";
import type { LlmClient } from "@kagami/llm-client";
import {
  InnerVoiceOperation,
  truncateByCodePoints,
} from "../../src/agent/capabilities/inner-voice/operations/inner-voice.operation.js";
import {
  EmitInnerThoughtTool,
  EMIT_INNER_THOUGHT_TOOL_NAME,
} from "../../src/agent/capabilities/inner-voice/tools/emit-inner-thought.tool.js";
import { createInnerVoiceInstructionMessage } from "../../src/agent/runtime/context/context-message-factory.js";

function createOperation(chatResponse: unknown): {
  operation: InnerVoiceOperation;
  chat: ReturnType<typeof vi.fn>;
} {
  const chat = vi.fn().mockResolvedValue(chatResponse);
  const llmClient = { chat } as unknown as LlmClient;
  const operation = new InnerVoiceOperation({
    llmClient,
    emitToolExecutor: new ToolCatalog([new EmitInnerThoughtTool()]).pick([
      EMIT_INNER_THOUGHT_TOOL_NAME,
    ]),
    instructionMessageFactory: createInnerVoiceInstructionMessage,
  });
  return { operation, chat };
}

function assistantEmit(thought: string): unknown {
  return {
    message: {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "t1", name: EMIT_INNER_THOUGHT_TOOL_NAME, arguments: { thought } }],
    },
  };
}

describe("InnerVoiceOperation", () => {
  it("产出非空念头并强制 toolChoice / usage=innerVoice", async () => {
    const { operation, chat } = createOperation(assistantEmit("想翻翻那篇文章"));
    const result = await operation.execute({
      systemPrompt: "persona",
      messages: [{ role: "user", content: "material" }],
    });

    expect(result.thought).toBe("想翻翻那篇文章");
    const [request, options] = chat.mock.calls[0] as [
      { toolChoice: unknown; messages: { content: string }[] },
      { usage: string },
    ];
    expect(request.toolChoice).toEqual({ tool_name: EMIT_INNER_THOUGHT_TOOL_NAME });
    expect(options.usage).toBe("innerVoice");
    // 指令消息追加在素材切片之后。
    expect(request.messages.at(-1)?.content).toContain("<system_instruction>");
  });

  it("空 thought → null（不注入），空白也算空", async () => {
    const { operation } = createOperation(assistantEmit("   "));
    const result = await operation.execute({ systemPrompt: "p", messages: [] });
    expect(result.thought).toBeNull();
  });

  it("LLM 没按约调用 emit 工具 → null", async () => {
    const { operation } = createOperation({
      message: { role: "assistant", content: "我想……", toolCalls: [] },
    });
    const result = await operation.execute({ systemPrompt: "p", messages: [] });
    expect(result.thought).toBeNull();
  });

  it("超长念头按码点截断", async () => {
    const { operation } = createOperation(assistantEmit("啊".repeat(200)));
    const result = await operation.execute({ systemPrompt: "p", messages: [] });
    expect(result.thought).toHaveLength(120);
  });
});

describe("truncateByCodePoints", () => {
  it("不劈 UTF-16 代理对（issue #187 教训）", () => {
    const value = "🀄".repeat(130); // 每个是一个代理对（2 个 UTF-16 code unit）
    const truncated = truncateByCodePoints(value, 120);
    expect([...truncated]).toHaveLength(120);
    // 尾部不是 lone surrogate。
    const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
    expect(lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff).toBe(false);
  });

  it("不超限时原样返回", () => {
    expect(truncateByCodePoints("短", 120)).toBe("短");
  });
});
