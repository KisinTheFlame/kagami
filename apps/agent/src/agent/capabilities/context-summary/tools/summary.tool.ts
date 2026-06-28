import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";

export const SUMMARY_TOOL_NAME = "summary";

const SummaryArgumentsSchema = z.object({
  summary: z.string().trim().min(1),
});

export class SummaryTool extends ZodToolComponent<typeof SummaryArgumentsSchema> {
  public readonly name = SUMMARY_TOOL_NAME;
  public readonly description =
    "写入供后续继续工作的对话摘要。应尽量遵循当前 summarizer prompt 指定的分段结构，但这里只做字符串宽松接收，不做参数级强校验。";
  public readonly parameters = {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "面向同一个 agent 后续继续工作的累计上下文摘要；应尽量遵循当前 summarizer prompt 指定的分段结构，但不会做参数级强校验。",
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
