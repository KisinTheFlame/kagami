import type { ChatCompletionMessageToolCall, ChatCompletionTool } from "openai/resources/chat/completions";
import {
  executeGetServerTimeTool,
  GET_SERVER_TIME_TOOL_NAME,
  getServerTimeTool,
} from "./get-server-time.js";

export const AGENT_TOOLS: ChatCompletionTool[] = [getServerTimeTool];

export async function executeToolCall(toolCall: ChatCompletionMessageToolCall): Promise<string> {
  if (toolCall.type !== "function") {
    return JSON.stringify({ error: `Unsupported tool call type: ${toolCall.type}` });
  }

  if (toolCall.function.name === GET_SERVER_TIME_TOOL_NAME) {
    return executeGetServerTimeTool();
  }

  return JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
}
