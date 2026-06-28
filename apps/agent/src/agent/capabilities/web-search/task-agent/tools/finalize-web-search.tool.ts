import { z } from "zod";
import {
  TERMINATE_EFFECT_TYPE,
  ZodToolComponent,
  type TerminateEffect,
  type ToolExecutionResult,
  type ToolKind,
} from "@kagami/agent-runtime";

export const FINALIZE_WEB_SEARCH_TOOL_NAME = "finalize_web_search";

const FinalizeWebSearchArgumentsSchema = z.object({
  summary: z.string().trim().min(1),
});

/**
 * WebSearchTaskAgent 的终止工具。产 `terminate` Effect 让 BaseTaskAgent 退出
 * invoke 循环；content 是最终摘要，作为 buildResult 入参。
 */
export class FinalizeWebSearchTool extends ZodToolComponent<
  typeof FinalizeWebSearchArgumentsSchema
> {
  public readonly name = FINALIZE_WEB_SEARCH_TOOL_NAME;
  public readonly description =
    "在信息已经足够时提交最终搜索摘要。摘要必须基于已检索到的结果，并明确保留不确定性。";
  public readonly parameters = {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "给主 Agent 的最终中文摘要。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = FinalizeWebSearchArgumentsSchema;

  protected async executeTyped(
    input: z.infer<typeof FinalizeWebSearchArgumentsSchema>,
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
