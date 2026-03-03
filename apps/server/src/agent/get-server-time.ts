import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const GET_SERVER_TIME_TOOL_NAME = "get_server_time";

export const getServerTimeTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: GET_SERVER_TIME_TOOL_NAME,
    description: "获取当前服务器时间（ISO 8601）。",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
};

export function executeGetServerTimeTool(): string {
  return JSON.stringify({ now: new Date().toISOString() });
}
