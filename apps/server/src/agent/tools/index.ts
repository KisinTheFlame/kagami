import type { Tool } from "../../llm/types.js";
import { FINISH_TOOL_NAME, finishTool } from "./finish.js";
import { createSearchWebTool, SEARCH_WEB_TOOL_NAME } from "./search-web.js";
import { createSendGroupMessageTool, SEND_GROUP_MESSAGE_TOOL_NAME } from "./send-group-message.js";
import type { WebSearchInput, WebSearchResult } from "../../service/web-search.service.js";

export type ToolExecutionResult = {
  content: string;
  shouldFinishRound: boolean;
};

export type AgentToolDefinition = {
  tool: Tool;
  execute: (argumentsValue: Record<string, unknown>) => Promise<ToolExecutionResult>;
};

export type AgentToolRegistry = Record<string, AgentToolDefinition>;

type CreateAgentToolRegistryDeps = {
  sendGroupMessage: (input: { message: string }) => Promise<{ messageId: number }>;
  searchWeb: (input: WebSearchInput) => Promise<WebSearchResult>;
};

export function createAgentToolRegistry({
  sendGroupMessage,
  searchWeb,
}: CreateAgentToolRegistryDeps): AgentToolRegistry {
  return {
    [SEARCH_WEB_TOOL_NAME]: createSearchWebTool({ searchWeb }),
    [SEND_GROUP_MESSAGE_TOOL_NAME]: createSendGroupMessageTool({ sendGroupMessage }),
    [FINISH_TOOL_NAME]: finishTool,
  };
}
