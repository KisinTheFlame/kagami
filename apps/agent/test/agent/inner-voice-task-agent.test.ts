import { describe, expect, it, vi } from "vitest";
import { createUnguardedSubtoolOwner, ToolCatalog } from "@kagami/agent-runtime";
import type { LlmChatResponsePayload, LlmClient } from "@kagami/llm-client";
import { InnerVoiceTaskAgent } from "../../src/agent/capabilities/inner-voice/task-agent/inner-voice-task-agent.js";
import {
  EmitInnerThoughtTool,
  EMIT_INNER_THOUGHT_TOOL_NAME,
} from "../../src/agent/capabilities/inner-voice/tools/emit-inner-thought.tool.js";
import { createInnerVoiceInstructionMessage } from "../../src/agent/runtime/context/context-message-factory.js";
import {
  InvokeTool,
  INVOKE_TOOL_NAME,
} from "../../src/agent/runtime/root-agent/tools/invoke.tool.js";

/**
 * 聚焦 InnerVoiceTaskAgent 的 invoke 调度 + emit 终止 + buildResult 截断的最小装配。
 * 真实工厂里 taskTools 是主 Agent 镜像的全套顶层工具（OutOfScope 软拒绝 + invoke），
 * 这里只放 invoke 一支——本测试只验 emit 终止路径，OutOfScope 软拒绝是别的话题。
 */
function createAgent(chat: ReturnType<typeof vi.fn>): InnerVoiceTaskAgent {
  const llmClient: LlmClient = {
    chat,
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn().mockResolvedValue([]),
  };
  const invokeTool = new InvokeTool({
    owners: [createUnguardedSubtoolOwner({ tools: [new EmitInnerThoughtTool()] })],
  });
  const taskTools = new ToolCatalog([invokeTool]).pick([INVOKE_TOOL_NAME]);
  return new InnerVoiceTaskAgent({ llmClient, taskTools });
}

function emitThought(thought: string): LlmChatResponsePayload {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    message: {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "emit-1",
          name: INVOKE_TOOL_NAME,
          arguments: { tool: EMIT_INNER_THOUGHT_TOOL_NAME, thought },
        },
      ],
    },
  };
}

describe("InnerVoiceTaskAgent", () => {
  it("emit 非空念头 → 复用完整前缀 + auto + usage=innerVoice，返回念头", async () => {
    const chat = vi.fn().mockResolvedValueOnce(emitThought("想翻翻那篇文章"));
    const agent = createAgent(chat);

    await expect(
      agent.invoke({
        systemPrompt: "persona",
        messages: [{ role: "user", content: "material" }],
      }),
    ).resolves.toBe("想翻翻那篇文章");

    // 复用主 Agent system + 完整消息前缀，尾部只多一条 inner-voice 指令；toolChoice auto。
    expect(chat).toHaveBeenNthCalledWith(
      1,
      {
        system: "persona",
        messages: [{ role: "user", content: "material" }, createInnerVoiceInstructionMessage()],
        toolChoice: "auto",
        tools: expect.arrayContaining([expect.objectContaining({ name: INVOKE_TOOL_NAME })]),
      },
      { usage: "innerVoice" },
    );
  });

  it("emit 空字符串 → 返回 ''（调用方据此判 empty 不注入）", async () => {
    const agent = createAgent(vi.fn().mockResolvedValueOnce(emitThought("   ")));
    await expect(agent.invoke({ systemPrompt: "p", messages: [] })).resolves.toBe("");
  });

  it("超长念头按码点截断到 120", async () => {
    const agent = createAgent(vi.fn().mockResolvedValueOnce(emitThought("啊".repeat(200))));
    const result = await agent.invoke({ systemPrompt: "p", messages: [] });
    expect(result).toHaveLength(120);
  });

  it("超长 emoji 念头按码点截断且不劈代理对（issue #187 教训）", async () => {
    const agent = createAgent(vi.fn().mockResolvedValueOnce(emitThought("🀄".repeat(130))));
    const result = await agent.invoke({ systemPrompt: "p", messages: [] });
    expect([...result]).toHaveLength(120);
    const lastCodeUnit = result.charCodeAt(result.length - 1);
    expect(lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff).toBe(false);
  });

  it("systemPrompt 为空白 → createInvocation 抛错", async () => {
    const agent = createAgent(vi.fn());
    await expect(agent.invoke({ systemPrompt: "   ", messages: [] })).rejects.toThrow(
      "InnerVoiceTaskAgent requires a non-empty systemPrompt",
    );
  });
});
