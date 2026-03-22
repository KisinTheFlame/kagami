import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "../../../tools/core/tool-component.js";

export const WRITE_REPLY_MESSAGE_TOOL_NAME = "write_reply_message";

const WriteReplyMessageArgumentsSchema = z.object({
  message: z.string().trim().min(1),
});

export class WriteReplyMessageTool extends ZodToolComponent<
  typeof WriteReplyMessageArgumentsSchema
> {
  public readonly name = WRITE_REPLY_MESSAGE_TOOL_NAME;
  public readonly description = "写出本次要发送到群里的最终文本消息。";
  public readonly parameters = {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "最终要发送的群消息文本。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = WriteReplyMessageArgumentsSchema;

  protected override formatInvalidArguments(): string {
    return "";
  }

  protected async executeTyped(
    input: z.infer<typeof WriteReplyMessageArgumentsSchema>,
  ): Promise<string> {
    return input.message.trim();
  }
}
