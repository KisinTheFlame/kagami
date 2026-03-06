import type { Tool } from "../../llm/types.js";

export const FINISH_TOOL_NAME = "finish";

export const finishTool: Tool = {
  name: FINISH_TOOL_NAME,
  description: "结束当前轮次；如果没有新事件，则进入等待状态。",
  parameters: {
    type: "object",
    properties: {},
  },
};

export function executeFinishTool(): string {
  return JSON.stringify({ finished: true });
}
