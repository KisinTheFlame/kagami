import { z } from "zod";
import {
  TERMINATE_EFFECT_TYPE,
  ZodToolComponent,
  type TerminateEffect,
  type ToolExecutionResult,
  type ToolKind,
} from "@kagami/agent-runtime";

export const FINALIZE_SUMMARY_TOOL_NAME = "finalize_summary";

const FinalizeSummaryArgumentsSchema = z.object({
  summary: z.string().trim().min(1),
});

/**
 * SummaryTaskAgent 的终止工具。产 `terminate` Effect 让 BaseTaskAgent 退出
 * invoke 循环；content 是最终摘要，作为 buildResult 入参。
 * 摘要的分段结构由 summarizer 指令模板约束，这里只做字符串宽松接收。
 */
export class FinalizeSummaryTool extends ZodToolComponent<typeof FinalizeSummaryArgumentsSchema> {
  public readonly name = FINALIZE_SUMMARY_TOOL_NAME;
  public readonly description =
    "提交供后续继续工作的对话摘要并结束本次摘要子任务。应尽量遵循当前 summarizer 指令指定的分段结构，但这里只做字符串宽松接收，不做参数级强校验。";
  public readonly parameters = {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "面向同一个 agent 后续继续工作的累计上下文摘要；应尽量遵循当前 summarizer 指令指定的分段结构。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = FinalizeSummaryArgumentsSchema;

  protected async executeTyped(
    input: z.infer<typeof FinalizeSummaryArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const summary = input.summary.trim();
    // terminate Effect 自描述：把 summary 携带在 Effect 字段里，TaskEffectInterpreter
    // 直接从 Effect 拿（不依赖 tool.result.content）。
    const terminate: TerminateEffect = { type: TERMINATE_EFFECT_TYPE, content: summary };
    return {
      content: summary,
      effects: [terminate],
    };
  }
}
