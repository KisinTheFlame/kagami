import { describe, expect, it, vi } from "vitest";
import { createSearchMemoryTool } from "../../src/agent/tools/search-memory.js";
import type { GroupMessageMemorySearchService } from "../../src/rag/memory-search.service.js";

describe("search memory tool", () => {
  it("should skip search when shouldSearch is false", async () => {
    const memorySearchService = {
      search: vi.fn(),
    } as unknown as GroupMessageMemorySearchService;

    const tool = createSearchMemoryTool({
      memorySearchService,
    });

    await expect(
      tool.execute({
        shouldSearch: false,
        query: "",
        groupId: "123456",
      }),
    ).resolves.toEqual({
      content: "",
      shouldFinishRound: false,
    });
    expect(memorySearchService.search).not.toHaveBeenCalled();
  });

  it("should search memory when arguments are valid", async () => {
    const memorySearchService = {
      search: vi.fn().mockResolvedValue("<memory_history_message />"),
    } as unknown as GroupMessageMemorySearchService;

    const tool = createSearchMemoryTool({
      memorySearchService,
    });

    await expect(
      tool.execute({
        shouldSearch: true,
        query: "老话题",
        groupId: "123456",
      }),
    ).resolves.toEqual({
      content: "<memory_history_message />",
      shouldFinishRound: false,
    });
    expect(memorySearchService.search).toHaveBeenCalledWith({
      groupId: "123456",
      query: "老话题",
    });
  });
});
