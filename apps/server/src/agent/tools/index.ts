import type { Tool, LlmToolCall } from "../../llm/types.js";
import { executeFinishTool, FINISH_TOOL_NAME, finishTool } from "./finish.js";
import {
  executeGetServerTimeTool,
  GET_SERVER_TIME_TOOL_NAME,
  getServerTimeTool,
} from "./get-server-time.js";
import {
  executeSendGroupMessageTool,
  SEND_GROUP_MESSAGE_TOOL_NAME,
  sendGroupMessageTool,
} from "./send-group-message.js";

export type ToolExecutionResult = {
  content: string;
  shouldFinishRound: boolean;
};

export type ToolExecutionDeps = {
  sendGroupMessage: (input: { message: string }) => Promise<{ messageId: number }>;
};

export const AGENT_TOOLS: Tool[] = [getServerTimeTool, sendGroupMessageTool, finishTool];

export async function executeToolCall(
  toolCall: LlmToolCall,
  deps: ToolExecutionDeps,
): Promise<ToolExecutionResult> {
  if (toolCall.name === GET_SERVER_TIME_TOOL_NAME) {
    return {
      content: executeGetServerTimeTool(),
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
