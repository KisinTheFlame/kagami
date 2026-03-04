import type { Tool, LlmToolCall } from "../llm/types.js";
import {
  executeGetServerTimeTool,
  GET_SERVER_TIME_TOOL_NAME,
  getServerTimeTool,
} from "./get-server-time.js";

export const AGENT_TOOLS: Tool[] = [getServerTimeTool];

export async function executeToolCall(toolCall: LlmToolCall): Promise<string> {
  if (toolCall.name === GET_SERVER_TIME_TOOL_NAME) {
    return executeGetServerTimeTool();
  }

  return JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
}
