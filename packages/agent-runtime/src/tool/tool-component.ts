import { z } from "zod";
import type { JsonSchema, LlmMessage, Tool } from "@kagami/llm";
import type { Effect } from "../effect.js";

// JsonSchema / Tool 是 LLM 协议层类型，定义在 @kagami/llm；这里 import 后再 export，
// 让 agent-runtime 内部沿用 "从 tool-component 引入" 的习惯（避开 export...from 限制）。
export type { JsonSchema, Tool };

export type ToolKind = "business" | "control";

export type ToolContext = {
  systemPrompt?: string;
  messages?: LlmMessage[];
};

export type ToolExecutionResult = {
  /** 必返。给 LLM 看的字符串，落到 tool_result 里（ReAct 协议要求每个 tool_call 都跟一个 tool_result）。 */
  content: string;
  /**
   * 可选。结构化副作用描述，由 Agent 的 EffectInterpreter 按数组顺序解释。
   * Effect 是开放接口；具体类型由调用方 Agent 解释。
   */
  effects?: readonly Effect[];
};

export interface ToolComponent {
  readonly name: string;
  readonly description?: string;
  readonly parameters: JsonSchema;
  readonly kind: ToolKind;
  readonly llmTool: Tool;
  execute(
    argumentsValue: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolExecutionResult>;
}

type ToolResultFormatter = (error: unknown) => string;

const DEFAULT_INVALID_ARGUMENTS_FORMATTER: ToolResultFormatter = error => {
  if (error instanceof z.ZodError) {
    return JSON.stringify({
      ok: false,
      error: "INVALID_ARGUMENTS",
      details: error.issues.map(issue => issue.message),
    });
  }

  return JSON.stringify({
    ok: false,
    error: "INVALID_ARGUMENTS",
  });
};

const DEFAULT_EXECUTION_ERROR_FORMATTER: ToolResultFormatter = error =>
  JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });

export abstract class ZodToolComponent<TInput extends z.ZodTypeAny> implements ToolComponent {
  public abstract readonly name: string;
  public abstract readonly description?: string;
  public abstract readonly parameters: JsonSchema;
  public abstract readonly kind: ToolKind;
  protected abstract readonly inputSchema: TInput;

  public get llmTool(): Tool {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }

  public async execute(
    argumentsValue: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    const parsed = this.inputSchema.safeParse(argumentsValue);
    if (!parsed.success) {
      return {
        content: this.formatInvalidArguments(parsed.error),
      };
    }

    try {
      const result = await this.executeTyped(parsed.data as z.infer<TInput>, context);
      if (typeof result === "string") {
        return { content: result };
      }

      return result;
    } catch (error) {
      return {
        content: this.formatExecutionError(error),
      };
    }
  }

  protected formatInvalidArguments(error: z.ZodError): string {
    return DEFAULT_INVALID_ARGUMENTS_FORMATTER(error);
  }

  protected formatExecutionError(error: unknown): string {
    return DEFAULT_EXECUTION_ERROR_FORMATTER(error);
  }

  protected abstract executeTyped(
    input: z.infer<TInput>,
    context: ToolContext,
  ): Promise<string | ToolExecutionResult> | string | ToolExecutionResult;
}
