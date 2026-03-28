import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "../../core/tool-component.js";

export const SUMMARY_TOOL_NAME = "summary";

const SummaryArgumentsSchema = z.object({
  summary: z.string().trim().min(1),
});

export class SummaryTool extends ZodToolComponent<typeof SummaryArgumentsSchema> {
  public readonly name = SUMMARY_TOOL_NAME;
  public readonly description =
    "写入供后续继续工作的对话摘要。只保留关键事实、当前目标、未完成事项、重要约束和必要上下文。";
  public readonly parameters = {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "面向同一个 agent 后续继续工作的累计上下文摘要。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SummaryArgumentsSchema;

  protected override formatInvalidArguments(): string {
    return "";
  }

  protected async executeTyped(input: z.infer<typeof SummaryArgumentsSchema>): Promise<string> {
    return input.summary.trim();
  }
}
