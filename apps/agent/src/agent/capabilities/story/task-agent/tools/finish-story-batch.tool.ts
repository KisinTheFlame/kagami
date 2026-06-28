import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";

export const FINISH_STORY_BATCH_TOOL_NAME = "finish_story_batch";

const FinishStoryBatchArgumentsSchema = z.object({});

export class FinishStoryBatchTool extends ZodToolComponent<typeof FinishStoryBatchArgumentsSchema> {
  public readonly name = FINISH_STORY_BATCH_TOOL_NAME;
  public readonly description = "当本批消息已经完成叙事整理后，结束本轮处理。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = FinishStoryBatchArgumentsSchema;

  protected async executeTyped(): Promise<ToolExecutionResult> {
    return {
      content: "story batch finished",
    };
  }
}
