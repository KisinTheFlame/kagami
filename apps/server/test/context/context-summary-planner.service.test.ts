import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "../../src/llm/client.js";
import { ContextSummaryOperation } from "../../src/agent/capabilities/context-summary/operations/context-summary.operation.js";
import {
  SUMMARY_TOOL_NAME,
  SummaryTool,
} from "../../src/agent/capabilities/context-summary/tools/summary.tool.js";
import { REPLACE_LEADING_MESSAGES_EFFECT_TYPE, ToolCatalog } from "@kagami/agent-runtime";

describe("ContextSummaryOperation", () => {
  it("forces the summary tool and emits a replace_messages effect with summary + kept messages", async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "summary-call-1",
            name: SUMMARY_TOOL_NAME,
            arguments: {
              summary: "累计摘要",
            },
          },
        ],
      },
    });
    const llmClient: LlmClient = {
      chat,
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const operation = new ContextSummaryOperation({
      llmClient,
      summaryToolExecutor: new ToolCatalog([new SummaryTool()]).pick([SUMMARY_TOOL_NAME]),
      reminderMessageFactory: () => ({
        role: "user",
        content: "<system_reminder>请整理 root 摘要</system_reminder>",
      }),
    });

    const result = await operation.execute({
      systemPrompt: "runtime-system-prompt",
      messages: [
        { role: "user", content: "旧消息-1" },
        { role: "user", content: "旧消息-2" },
      ],
      tools: [
        {
          name: "search_web",
          description: "search",
          parameters: { type: "object", properties: {} },
        },
        {
          name: SUMMARY_TOOL_NAME,
          description: "summary",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(result.effects).toHaveLength(1);
    const effect = result.effects[0];
    expect(effect.type).toBe(REPLACE_LEADING_MESSAGES_EFFECT_TYPE);
    // count = 被摘要的前缀长度（input.messages.length）
    expect(effect.count).toBe(2);
    // replacement 是单条 summary message
    expect(effect.replacement).toHaveLength(1);

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "runtime-system-prompt",
        messages: [
          { role: "user", content: "旧消息-1" },
          { role: "user", content: "旧消息-2" },
          { role: "user", content: "<system_reminder>请整理 root 摘要</system_reminder>" },
        ],
        toolChoice: { tool_name: SUMMARY_TOOL_NAME },
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "search_web" }),
          expect.objectContaining({ name: SUMMARY_TOOL_NAME }),
        ]),
      }),
      {
        usage: "contextSummarizer",
      },
    );
  });

  it("emits no effects when the first tool call is not summary", async () => {
    const llmClient: LlmClient = {
      chat: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "1", name: "search_web", arguments: {} }],
        },
      }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const operation = new ContextSummaryOperation({
      llmClient,
      summaryToolExecutor: new ToolCatalog([new SummaryTool()]).pick([SUMMARY_TOOL_NAME]),
      reminderMessageFactory: () => ({
        role: "user",
        content: "<system_reminder>请整理 story 摘要</system_reminder>",
      }),
    });

    const result = await operation.execute({
      systemPrompt: "story-system-prompt",
      messages: [],
      tools: [{ name: SUMMARY_TOOL_NAME, parameters: { type: "object", properties: {} } }],
    });

    expect(result.effects).toEqual([]);
  });
});
