import type { AgentToolDefinition } from "./index.js";

export const FINISH_TOOL_NAME = "finish";

export const finishTool: AgentToolDefinition = {
  tool: {
    name: FINISH_TOOL_NAME,
    description: "结束当前轮次；如果没有新事件，则进入等待状态。",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  execute: async () => ({
    content: "",
    shouldFinishRound: true,
  }),
};
