import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "../../../tools/core/tool-component.js";

export const DECIDE_REPLY_TOOL_NAME = "decide_reply";

const DecideReplyArgumentsSchema = z.object({
  shouldSend: z.boolean(),
  message: z.string().trim(),
});

export class DecideReplyTool extends ZodToolComponent<typeof DecideReplyArgumentsSchema> {
  public readonly name = DECIDE_REPLY_TOOL_NAME;
  public readonly description = "最终裁决这次是否发送群消息；若发送，则同时给出最终要发送的文本。";
  public readonly parameters = {
    type: "object",
    properties: {
      shouldSend: {
        type: "boolean",
        description: "这次是否应该真的发送群消息。",
      },
      message: {
        type: "string",
        description: "最终要发送的群消息文本；不发送时传空字符串。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = DecideReplyArgumentsSchema;

  protected override formatInvalidArguments(): string {
    return "";
  }

  protected async executeTyped(input: z.infer<typeof DecideReplyArgumentsSchema>): Promise<string> {
    return JSON.stringify({
      shouldSend: input.shouldSend,
      message: input.message.trim(),
    });
  }
}
