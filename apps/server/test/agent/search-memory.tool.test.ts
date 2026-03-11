import { describe, expect, it, vi } from "vitest";
import { createSearchMemoryTool, searchMemoryTool } from "../../src/agent/tools/search-memory.js";
import type { GroupMessageMemorySearchService } from "../../src/rag/memory-search.service.js";

describe("search memory tool", () => {
  it("should not expose groupId to llm tool parameters", () => {
    expect(searchMemoryTool.parameters).toEqual({
      type: "object",
      properties: {
        shouldSearch: {
          type: "boolean",
          description: "是否需要执行历史检索。不需要检索时设为 false。",
        },
        query: {
          type: "string",
          description: "需要检索时使用的短 query；不检索时留空字符串。",
        },
      },
    });
  });

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
