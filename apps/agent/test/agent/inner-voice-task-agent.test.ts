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

function emitThoughts(thoughts: string[]): LlmChatResponsePayload {
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
          arguments: { tool: EMIT_INNER_THOUGHT_TOOL_NAME, thoughts },
        },
      ],
    },
  };
}

describe("InnerVoiceTaskAgent", () => {
  it("emit 非空念头 → 复用完整前缀 + auto + usage=agent/scene=innerVoice，返回念头", async () => {
    const chat = vi.fn().mockResolvedValueOnce(emitThoughts(["想翻翻那篇文章", "去看看她回没回"]));
    const agent = createAgent(chat);

    await expect(
      agent.invoke({
        systemPrompt: "persona",
        messages: [{ role: "user", content: "material" }],
      }),
    ).resolves.toEqual(["想翻翻那篇文章", "去看看她回没回"]);

    // 复用主 Agent system + 完整消息前缀，尾部只多一条 inner-voice 指令；toolChoice auto。
    expect(chat).toHaveBeenNthCalledWith(
      1,
      {
        system: "persona",
        messages: [{ role: "user", content: "material" }, createInnerVoiceInstructionMessage()],
        toolChoice: "auto",
        tools: expect.arrayContaining([expect.objectContaining({ name: INVOKE_TOOL_NAME })]),
      },
      { usage: "agent", scene: "innerVoice" },
    );
  });

  it("emit 空数组 / 全空白 → 返回 []（调用方据此判 empty 不注入）", async () => {
    const empty = createAgent(vi.fn().mockResolvedValueOnce(emitThoughts([])));
    await expect(empty.invoke({ systemPrompt: "p", messages: [] })).resolves.toEqual([]);

    const blank = createAgent(vi.fn().mockResolvedValueOnce(emitThoughts(["   ", ""])));
    await expect(blank.invoke({ systemPrompt: "p", messages: [] })).resolves.toEqual([]);
  });

  it("超长念头逐条按码点截断到 30（issue #592：整体截断会切掉最后一条半句）", async () => {
    const agent = createAgent(
      vi.fn().mockResolvedValueOnce(emitThoughts(["啊".repeat(200), "哦".repeat(50), "短的"])),
    );
    const result = await agent.invoke({ systemPrompt: "p", messages: [] });
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(30);
    expect(result[1]).toHaveLength(30);
    // 逐条截断的关键收益：靠后的候选不会被整体预算吃掉，「有退路」才成立。
    expect(result[2]).toBe("短的");
  });

  it("候选超过 4 条只取前 4 条", async () => {
    const agent = createAgent(
      vi.fn().mockResolvedValueOnce(emitThoughts(["一", "二", "三", "四", "五", "六"])),
    );
    await expect(agent.invoke({ systemPrompt: "p", messages: [] })).resolves.toEqual([
      "一",
      "二",
      "三",
      "四",
    ]);
  });

  it("超长 emoji 念头按码点截断且不劈代理对（issue #187 教训）", async () => {
    const agent = createAgent(vi.fn().mockResolvedValueOnce(emitThoughts(["🀄".repeat(130)])));
    const [result] = await agent.invoke({ systemPrompt: "p", messages: [] });
    expect([...result]).toHaveLength(30);
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
