import { describe, expect, it, vi } from "vitest";
import { RagQueryPlannerService } from "../../src/rag/rag-query-planner.service.js";
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
      systemPromptFactory: () => "system-prompt",
    });

    await expect(
      service.plan({
        groupId: "123456",
        contextMessages: [],
      }),
    ).resolves.toEqual([]);
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
      systemPromptFactory: () => "system-prompt",
    });

    await expect(
      service.plan({
        groupId: "123456",
        contextMessages: [],
      }),
    ).resolves.toEqual([
      {
        role: "user",
        content: "<memory_history_message>\n时间：2026-03-11 10:00:00\n</memory_history_message>",
      },
    ]);
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
      systemPromptFactory: () => "system-prompt",
    });

    await expect(
      service.plan({
        groupId: "123456",
        contextMessages: [],
      }),
    ).resolves.toEqual([]);
    expect(memorySearchService.search).not.toHaveBeenCalled();
  });

  it("should pass the full context through to the planner chat", async () => {
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
      systemPromptFactory: () => "system-prompt",
    });
    const contextMessages = [
      { role: "user", content: "<message>\nA (1):\nhello\n</message>" },
      { role: "user", content: "<message>\nB (2):\nworld\n</message>" },
    ] as const;

    await expect(
      service.plan({
        groupId: "123456",
        contextMessages: [...contextMessages],
      }),
    ).resolves.toEqual([]);

    expect((llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.messages).toEqual(
      contextMessages,
    );
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
        contextMessages: [],
      }),
    ).resolves.toEqual([]);

    expect((llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.system).toBe(
      "custom system prompt",
    );
  });
});
