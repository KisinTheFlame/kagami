import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "../../../tools/core/tool-component.js";

export const REVIEW_REPLY_STRATEGY_TOOL_NAME = "review_reply_strategy";

const ReviewReplyStrategyArgumentsSchema = z.object({
  approve: z.boolean(),
  thought: z.string().trim().min(1),
});

export class ReviewReplyStrategyTool extends ZodToolComponent<
  typeof ReviewReplyStrategyArgumentsSchema
> {
  public readonly name = REVIEW_REPLY_STRATEGY_TOOL_NAME;
  public readonly description = "审核当前回复策略是否值得执行，并给出简短审核意见。";
  public readonly parameters = {
    type: "object",
    properties: {
      approve: {
        type: "boolean",
        description: "当前回复策略是否值得执行。",
      },
      thought: {
        type: "string",
        description: "简短审核意见；通过时可写成最终写作约束。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ReviewReplyStrategyArgumentsSchema;

  protected override formatInvalidArguments(): string {
    return "";
  }

  protected async executeTyped(
    input: z.infer<typeof ReviewReplyStrategyArgumentsSchema>,
  ): Promise<string> {
    return JSON.stringify({
      approve: input.approve,
      thought: input.thought.trim(),
    });
  }
}
