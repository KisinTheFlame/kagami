import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "../../../tools/core/tool-component.js";

export const REPLY_THOUGHT_TOOL_NAME = "reply_thought";

const ReplyThoughtArgumentsSchema = z.object({
  thought: z.string().trim().min(1),
});

export class ReplyThoughtTool extends ZodToolComponent<typeof ReplyThoughtArgumentsSchema> {
  public readonly name = REPLY_THOUGHT_TOOL_NAME;
  public readonly description = "写下这次是否值得回复、最值得接的点，以及一个简短的回复方向提示。";
  public readonly parameters = {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "本次回复思考，需包含是否该回复、回复角度和简短草稿提示。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ReplyThoughtArgumentsSchema;

  protected override formatInvalidArguments(): string {
    return "";
  }

  protected async executeTyped(
    input: z.infer<typeof ReplyThoughtArgumentsSchema>,
  ): Promise<string> {
    return input.thought.trim();
  }
}
