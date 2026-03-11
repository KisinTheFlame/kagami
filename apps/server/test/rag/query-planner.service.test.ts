import { describe, expect, it, vi } from "vitest";
import { RagQueryPlannerService } from "../../src/rag/query-planner.service.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { GroupMessageMemorySearchService } from "../../src/rag/memory-search.service.js";
import { SearchMemoryTool, ToolCatalog } from "../../src/tools/index.js";

function createPlannerTools(memorySearchService: GroupMessageMemorySearchService) {
  return new ToolCatalog([new SearchMemoryTool({ memorySearchService })]).pick(["search_memory"]);
}

describe("RagQueryPlannerService", () => {
  it("should return null when planner decides not to search", async () => {
    const llmClient: LlmClient = {
      chat: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-1",
              name: "search_memory",
              arguments: { shouldSearch: false, query: "" },
            },
          ],
        },
      }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const memorySearchService = {
      search: vi.fn(),
    } as unknown as GroupMessageMemorySearchService;

    const service = new RagQueryPlannerService({
      llmClient,
      plannerTools: createPlannerTools(memorySearchService),
    });

    await expect(
      service.plan({
        groupId: "123456",
        currentMessage: "<message>\nA (1):\nhello\n</message>",
        contextMessages: [],
      }),
    ).resolves.toBeNull();
    expect(memorySearchService.search).not.toHaveBeenCalled();
  });

  it("should run one search when planner asks for it", async () => {
    const llmClient: LlmClient = {
      chat: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-1",
              name: "search_memory",
              arguments: { shouldSearch: true, query: "老话题" },
            },
          ],
        },
      }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const memorySearchService = {
      search: vi
        .fn()
        .mockResolvedValue(
          "<memory_history_message>\n时间：2026-03-11 10:00:00\n</memory_history_message>",
        ),
    } as unknown as GroupMessageMemorySearchService;

    const service = new RagQueryPlannerService({
      llmClient,
      plannerTools: createPlannerTools(memorySearchService),
    });

    await expect(
      service.plan({
        groupId: "123456",
        currentMessage: "<message>\nA (1):\nhello\n</message>",
        contextMessages: [],
      }),
    ).resolves.toContain("<memory_history_message>");
    expect(memorySearchService.search).toHaveBeenCalledWith({
      groupId: "123456",
      query: "老话题",
    });
    expect(llmClient.chat).toHaveBeenCalledTimes(1);
    expect((llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.toolChoice).toEqual({
      tool_name: "search_memory",
    });
  });

  it("should return null when planner requests search with an empty query", async () => {
    const llmClient: LlmClient = {
      chat: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-1",
              name: "search_memory",
              arguments: { shouldSearch: true, query: "   " },
            },
          ],
        },
      }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const memorySearchService = {
      search: vi.fn(),
    } as unknown as GroupMessageMemorySearchService;

    const service = new RagQueryPlannerService({
      llmClient,
      plannerTools: createPlannerTools(memorySearchService),
    });

    await expect(
      service.plan({
        groupId: "123456",
        currentMessage: "<message>\nA (1):\nhello\n</message>",
        contextMessages: [],
      }),
    ).resolves.toBeNull();
    expect(memorySearchService.search).not.toHaveBeenCalled();
  });

  it("should not duplicate the current message when it is already the last context message", async () => {
    const llmClient: LlmClient = {
      chat: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-1",
              name: "search_memory",
              arguments: { shouldSearch: false, query: "" },
            },
          ],
        },
      }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const memorySearchService = {
      search: vi.fn(),
    } as unknown as GroupMessageMemorySearchService;

    const service = new RagQueryPlannerService({
      llmClient,
      plannerTools: createPlannerTools(memorySearchService),
    });
    const currentMessage = "<message>\nA (1):\nhello\n</message>";

    await expect(
      service.plan({
        groupId: "123456",
        currentMessage,
        contextMessages: [{ role: "user", content: currentMessage }],
      }),
    ).resolves.toBeNull();

    expect((llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.messages).toEqual([
      { role: "user", content: currentMessage },
    ]);
  });

  it("should use the provided system prompt factory", async () => {
    const llmClient: LlmClient = {
      chat: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-1",
              name: "search_memory",
              arguments: { shouldSearch: false, query: "" },
            },
          ],
        },
      }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const memorySearchService = {
      search: vi.fn(),
    } as unknown as GroupMessageMemorySearchService;

    const service = new RagQueryPlannerService({
      llmClient,
      plannerTools: createPlannerTools(memorySearchService),
      systemPromptFactory: () => "custom system prompt",
    });

    await expect(
      service.plan({
        groupId: "123456",
        currentMessage: "<message>\nA (1):\nhello\n</message>",
        contextMessages: [],
      }),
    ).resolves.toBeNull();

    expect((llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.system).toBe(
      "custom system prompt",
    );
  });
});
