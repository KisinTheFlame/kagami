import { z } from "zod";
import { ZodToolComponent, type JsonSchema, type ToolKind } from "@kagami/agent-runtime";

export const CALCULATE_TOOL_NAME = "calculate";

const OPERATORS = ["+", "-", "*", "/"] as const;
type Operator = (typeof OPERATORS)[number];

const CalculateArgumentsSchema = z.object({
  a: z.number().finite(),
  op: z.enum(OPERATORS),
  b: z.number().finite(),
});

/**
 * 二元四则运算工具。Calc App 内唯一的工具。
 *
 * 设计要点：
 * - 单次调用只做一次二元运算。需要复合表达式（如 1+2*3）时，Kagami 自己组合多次调用。
 * - 严格只接受有限 number；NaN / Infinity 由 zod .finite() 提前挡掉。
 * - 除零返回结构化 error tool_result，不抛异常。
 */
export class CalculateTool extends ZodToolComponent<typeof CalculateArgumentsSchema> {
  public readonly name = CALCULATE_TOOL_NAME;
  public readonly description = "对两个有限实数做一次二元四则运算（+、-、*、/）。";
  public readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      a: { type: "number", description: "左操作数。" },
      op: { type: "string", description: '运算符。可选值: "+"、"-"、"*"、"/"。' },
      b: { type: "number", description: "右操作数。" },
    },
  };
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = CalculateArgumentsSchema;

  protected async executeTyped(input: z.infer<typeof CalculateArgumentsSchema>): Promise<string> {
    const result = computeBinaryOp(input.a, input.op, input.b);
    if (result.ok) {
      return JSON.stringify({ ok: true, result: result.value });
    }
    return JSON.stringify({ ok: false, error: result.error, message: result.message });
  }
}

function computeBinaryOp(
  a: number,
  op: Operator,
  b: number,
): { ok: true; value: number } | { ok: false; error: string; message: string } {
  switch (op) {
    case "+":
      return { ok: true, value: a + b };
    case "-":
      return { ok: true, value: a - b };
    case "*":
      return { ok: true, value: a * b };
    case "/":
      if (b === 0) {
        return {
          ok: false,
          error: "DIVISION_BY_ZERO",
          message: "除数不能是 0。",
        };
      }
      return { ok: true, value: a / b };
  }
}
