import { z } from "zod";
import {
  ZodToolComponent,
  type ToolExecutionResult,
  type ToolKind,
} from "../../core/tool-component.js";

export const FINISH_TOOL_NAME = "finish";

const FinishArgumentsSchema = z.object({});

export class FinishTool extends ZodToolComponent<typeof FinishArgumentsSchema> {
  public readonly name = FINISH_TOOL_NAME;
  public readonly description = "结束当前轮次；如果没有新事件，则进入等待状态。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = FinishArgumentsSchema;

  protected async executeTyped(): Promise<ToolExecutionResult> {
    return {
      content: "",
      signal: "finish_round",
    };
  }
}
