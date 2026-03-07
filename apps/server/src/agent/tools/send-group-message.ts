import { z } from "zod";
import type { Tool } from "../../llm/types.js";
import type { ToolExecutionDeps } from "./index.js";

export const SEND_GROUP_MESSAGE_TOOL_NAME = "send_group_message";

const SendGroupMessageArgumentsSchema = z.object({
  message: z.string().trim().min(1),
});

export const sendGroupMessageTool: Tool = {
  name: SEND_GROUP_MESSAGE_TOOL_NAME,
  description: "向当前监听的 QQ 群发送一条文本消息。",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "要发送到群里的文本内容。",
      },
    },
  },
};

export async function executeSendGroupMessageTool(
  argumentsValue: Record<string, unknown>,
  deps: ToolExecutionDeps,
): Promise<string> {
  const parsed = SendGroupMessageArgumentsSchema.safeParse(argumentsValue);
  if (!parsed.success) {
    return JSON.stringify({
      ok: false,
      error: "INVALID_ARGUMENTS",
      details: parsed.error.issues.map(issue => issue.message),
    });
  }

  try {
    const result = await deps.sendGroupMessage({
      message: parsed.data.message,
    });
    return JSON.stringify({
      ok: true,
      messageId: result.messageId,
    });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
