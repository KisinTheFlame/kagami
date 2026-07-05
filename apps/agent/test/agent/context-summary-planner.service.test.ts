import { describe, expect, it, vi } from "vitest";
import type { LlmClient, LlmChatResponsePayload } from "@kagami/llm-client";
import {
  createUnguardedSubtoolOwner,
  TaskAgentMaxRoundsExceededError,
  ToolCatalog,
} from "@kagami/agent-runtime";
import { SummaryTaskAgent } from "../../src/agent/capabilities/context-summary/task-agent/summary-task-agent.js";
import {
  FINALIZE_SUMMARY_TOOL_NAME,
  FinalizeSummaryTool,
} from "../../src/agent/capabilities/context-summary/task-agent/tools/finalize-summary.tool.js";
import {
  InvokeTool,
  INVOKE_TOOL_NAME,
} from "../../src/agent/runtime/root-agent/tools/invoke.tool.js";

/**
 * 最小装配：taskTools 只放 invokeTool（owner 只挂
 * finalize_summary），聚焦 invoke 调度 + 终止判定语义。
 */
function createSummaryTaskAgent(chat: ReturnType<typeof vi.fn>) {
  const llmClient: LlmClient = {
    chat,
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn().mockResolvedValue([]),
  };
  const invokeTool = new InvokeTool({
    owners: [createUnguardedSubtoolOwner({ tools: [new FinalizeSummaryTool()] })],
  });
  const toolCatalog = new ToolCatalog([invokeTool]);

  return new SummaryTaskAgent({
    llmClient,
    taskTools: toolCatalog.pick([INVOKE_TOOL_NAME]),
    reminderMessageFactory: () => ({
      role: "user",
      content: "<system_reminder>请整理 root 摘要</system_reminder>",
    }),
  });
}

function makeFinalizeCall(summary: string): LlmChatResponsePayload {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    message: {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "finalize-1",
          name: INVOKE_TOOL_NAME,
          arguments: { tool: FINALIZE_SUMMARY_TOOL_NAME, summary },
        },
      ],
    },
  };
}

function makeTextOnlyRound(content: string): LlmChatResponsePayload {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    message: {
      role: "assistant",
      content,
      toolCalls: [],
    },
  };
}

describe("SummaryTaskAgent", () => {
  it("appends the reminder message and returns the finalized summary", async () => {
    const chat = vi.fn().mockResolvedValue(makeFinalizeCall("累计摘要"));
    const agent = createSummaryTaskAgent(chat);

    await expect(
      agent.invoke({
        systemPrompt: "runtime-system-prompt",
        messages: [
          { role: "user", content: "旧消息-1" },
          { role: "user", content: "旧消息-2" },
        ],
      }),
    ).resolves.toBe("累计摘要");

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "runtime-system-prompt",
        messages: [
          { role: "user", content: "旧消息-1" },
          { role: "user", content: "旧消息-2" },
          { role: "user", content: "<system_reminder>请整理 root 摘要</system_reminder>" },
        ],
        toolChoice: "auto",
        tools: expect.arrayContaining([expect.objectContaining({ name: INVOKE_TOOL_NAME })]),
      }),
      {
        usage: "contextSummarizer",
      },
    );
  });

  it("keeps looping past text-only rounds until finalize", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(makeTextOnlyRound("我先梳理一下这段对话。"))
      .mockResolvedValueOnce(makeFinalizeCall("第二轮给出的摘要"));
    const agent = createSummaryTaskAgent(chat);

    await expect(
      agent.invoke({
        systemPrompt: "runtime-system-prompt",
        messages: [{ role: "user", content: "旧消息" }],
      }),
    ).resolves.toBe("第二轮给出的摘要");

    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("throws TaskAgentMaxRoundsExceededError when the model never finalizes", async () => {
    const chat = vi.fn().mockResolvedValue(makeTextOnlyRound("一直在自言自语。"));
    const agent = createSummaryTaskAgent(chat);

    await expect(
      agent.invoke({
        systemPrompt: "runtime-system-prompt",
        messages: [{ role: "user", content: "旧消息" }],
      }),
    ).rejects.toBeInstanceOf(TaskAgentMaxRoundsExceededError);

    // maxRounds = 4：跑满 4 轮后放弃。
    expect(chat).toHaveBeenCalledTimes(4);
  });
});
