import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "../../src/llm/client.js";
import { ContextSummaryPlannerService } from "../../src/agent/agents/subagents/context-summarizer/context-summary-planner.service.js";
import { SUMMARY_TOOL_NAME, SummaryTool, ToolCatalog } from "../../src/agent/tools/index.js";

describe("ContextSummaryPlannerService", () => {
  it("should force the summary tool and return its content", async () => {
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
    const planner = new ContextSummaryPlannerService({
      llmClient,
      summaryToolExecutor: new ToolCatalog([new SummaryTool()]).pick([SUMMARY_TOOL_NAME]),
    });

    await expect(
      planner.summarize({
        messages: [{ role: "user", content: "旧消息" }],
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
      }),
    ).resolves.toBe("累计摘要");

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
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

  it("should return null when the first tool call is not summary", async () => {
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
    const planner = new ContextSummaryPlannerService({
      llmClient,
      summaryToolExecutor: new ToolCatalog([new SummaryTool()]).pick([SUMMARY_TOOL_NAME]),
    });

    await expect(
      planner.summarize({
        messages: [],
        tools: [{ name: SUMMARY_TOOL_NAME, parameters: { type: "object", properties: {} } }],
      }),
    ).resolves.toBeNull();
  });
});
