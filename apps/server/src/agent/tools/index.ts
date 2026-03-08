import type { Tool, LlmToolCall } from "../../llm/types.js";
import { executeFinishTool, FINISH_TOOL_NAME, finishTool } from "./finish.js";
import { executeSearchWebTool, SEARCH_WEB_TOOL_NAME, searchWebTool } from "./search-web.js";
import {
  executeSendGroupMessageTool,
  SEND_GROUP_MESSAGE_TOOL_NAME,
  sendGroupMessageTool,
} from "./send-group-message.js";
import type { WebSearchInput, WebSearchResult } from "../../service/web-search.service.js";

export type ToolExecutionResult = {
  content: string;
  shouldFinishRound: boolean;
};

export type ToolExecutionDeps = {
  sendGroupMessage: (input: { message: string }) => Promise<{ messageId: number }>;
  searchWeb: (input: WebSearchInput) => Promise<WebSearchResult>;
};

export const AGENT_TOOLS: Tool[] = [searchWebTool, sendGroupMessageTool, finishTool];

export async function executeToolCall(
  toolCall: LlmToolCall,
  deps: ToolExecutionDeps,
): Promise<ToolExecutionResult> {
  if (toolCall.name === SEARCH_WEB_TOOL_NAME) {
    return {
      content: await executeSearchWebTool(toolCall.arguments, deps),
      shouldFinishRound: false,
    };
  }

  if (toolCall.name === SEND_GROUP_MESSAGE_TOOL_NAME) {
    return {
      content: await executeSendGroupMessageTool(toolCall.arguments, deps),
      shouldFinishRound: false,
    };
  }

  if (toolCall.name === FINISH_TOOL_NAME) {
    return {
      content: executeFinishTool(),
      shouldFinishRound: true,
    };
  }

  return {
    content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    shouldFinishRound: false,
  };
}
