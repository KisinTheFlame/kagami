import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";

export const FINISH_TOOL_NAME = "finish";

const FinishArgumentsSchema = z.object({});

export class FinishTool extends ZodToolComponent<typeof FinishArgumentsSchema> {
  public readonly name = FINISH_TOOL_NAME;
  public readonly description =
    "结束当前轮次；当你决定这次不回应，或当前不需要继续动作时使用。这代表自然停止，不代表失败。";
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
