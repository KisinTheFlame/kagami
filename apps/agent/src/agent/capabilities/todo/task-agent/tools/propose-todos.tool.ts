import { z } from "zod";
import {
  TERMINATE_EFFECT_TYPE,
  ZodToolComponent,
  type TerminateEffect,
  type ToolExecutionResult,
  type ToolKind,
} from "@kagami/agent-runtime";

export const PROPOSE_TODOS_TOOL_NAME = "propose_todos";

/** 单次子任务最多采纳的候选待办条数（模型多返回也在此截断）。 */
const MAX_SUGGESTIONS = 5;

// 宽松接收：只要 suggestions 是字符串数组即可（空白/空串在这里 trim+filter 兜底剔除）。
// 不做 per-element min 校验——否则模型多给一条空串会让整个数组解析失败、白白丢掉其余好建议。
const ProposeTodosArgumentsSchema = z.object({
  suggestions: z.array(z.string()).default([]),
});

/**
 * TodoSuggestionTaskAgent 的终止工具。产 `terminate` Effect 让 BaseTaskAgent 退出
 * invoke 循环；content 是归一化后候选待办标题数组的 JSON 序列化，buildResult 解析。
 * 空数组也是合法终止（「没有值得建议的」）。
 */
export class ProposeTodosTool extends ZodToolComponent<typeof ProposeTodosArgumentsSchema> {
  public readonly name = PROPOSE_TODOS_TOOL_NAME;
  public readonly description =
    "提交本次「发现待办」子任务的候选待办标题并结束子任务。suggestions 是标题字符串数组（最多 5 条），没有值得建议的就传空数组。";
  public readonly parameters = {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "string",
        },
        description: "候选待办标题数组；每条一句话、动词开头、具体可执行。没有就传 []。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = ProposeTodosArgumentsSchema;

  protected async executeTyped(
    input: z.infer<typeof ProposeTodosArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const suggestions = input.suggestions
      .map(suggestion => suggestion.trim())
      .filter(suggestion => suggestion.length > 0)
      .slice(0, MAX_SUGGESTIONS);
    const content = JSON.stringify(suggestions);
    const terminate: TerminateEffect = { type: TERMINATE_EFFECT_TYPE, content };
    return {
      content,
      effects: [terminate],
    };
  }
}
