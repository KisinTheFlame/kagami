import { z } from "zod";
import type { GroupMessageMemorySearchService } from "../../rag/memory-search.service.js";
import type { Tool } from "../../llm/types.js";
import type { AgentToolDefinition } from "./index.js";

export const SEARCH_MEMORY_TOOL_NAME = "search_memory";

const SearchMemoryToolArgumentsSchema = z.object({
  shouldSearch: z.boolean(),
  query: z.string(),
});

const SearchMemoryExecutionArgumentsSchema = SearchMemoryToolArgumentsSchema.extend({
  groupId: z.string().trim().min(1),
});

export const searchMemoryTool: Tool = {
  name: SEARCH_MEMORY_TOOL_NAME,
  description:
    "在需要补充群聊上下文时检索同一群的历史消息。只有当当前最新消息存在省略指代、明显接上文、翻旧账、引用之前说法，或脱离历史就难以理解时，才应把 shouldSearch 设为 true。query 应该简短、具体、面向检索，尽量提炼成少量关键词或短语，不要写成长句、解释、礼貌用语或回复草稿。若当前消息只是寒暄、表情、单独就能看懂的句子，或历史并不会帮助判断语义，就把 shouldSearch 设为 false，并将 query 留空。",
  parameters: {
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
  },
};

type CreateSearchMemoryToolDeps = {
  memorySearchService: GroupMessageMemorySearchService;
};

export function createSearchMemoryTool({
  memorySearchService,
}: CreateSearchMemoryToolDeps): AgentToolDefinition {
  return {
    tool: searchMemoryTool,
    execute: async argumentsValue => ({
      content: await executeSearchMemory(argumentsValue, { memorySearchService }),
      shouldFinishRound: false,
    }),
  };
}

async function executeSearchMemory(
  argumentsValue: Record<string, unknown>,
  deps: CreateSearchMemoryToolDeps,
): Promise<string> {
  const parsed = SearchMemoryExecutionArgumentsSchema.safeParse(argumentsValue);
  if (!parsed.success) {
    return "";
  }

  if (!parsed.data.shouldSearch) {
    return "";
  }

  const query = parsed.data.query.trim();
  if (query.length === 0) {
    return "";
  }

  return await deps.memorySearchService.search({
    groupId: parsed.data.groupId,
    query,
  });
}
