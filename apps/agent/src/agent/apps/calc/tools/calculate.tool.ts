import { z } from "zod";
import { ZodToolComponent, type JsonSchema, type ToolKind } from "@kagami/agent-runtime";

const CALCULATE_TOOL_NAME = "calculate";

const OPERATORS = ["+", "-", "*", "/"] as const;
type Operator = (typeof OPERATORS)[number];

const CalculateArgumentsSchema = z.object({
  a: z.number().finite(),
  op: z.enum(OPERATORS),
  b: z.number().finite(),
});

type CalculateToolDeps = {
  /**
   * 返回当前 calc App 配置中的 precision。undefined 表示不做四舍五入。
   *
   * 用闭包而不是直接传 number 是为了让 calc App 可以在 onStartup 之后修改自身
   * 配置（理论上未来若加 reload），而工具不必重建。
   */
  getPrecision: () => number | undefined;
};

/**
 * 二元四则运算工具。Calc App 内唯一的工具。
 *
 * 设计要点：
 * - 单次调用只做一次二元运算。需要复合表达式（如 1+2*3）时，Kagami 自己组合多次调用。
 * - 严格只接受有限 number；NaN / Infinity 由 zod .finite() 提前挡掉。
 * - 除零返回结构化 error tool_result，不抛异常。
 * - precision 来自 CalcApp 的 config 闭包，undefined 表示不截断。
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

  private readonly getPrecision: () => number | undefined;

  public constructor({ getPrecision }: CalculateToolDeps) {
    super();
    this.getPrecision = getPrecision;
  }

  protected async executeTyped(input: z.infer<typeof CalculateArgumentsSchema>): Promise<string> {
    const result = computeBinaryOp(input.a, input.op, input.b);
    if (result.ok) {
      return JSON.stringify({
        ok: true,
        result: applyPrecision(result.value, this.getPrecision()),
      });
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

function applyPrecision(value: number, precision: number | undefined): number {
  if (precision === undefined) {
    return value;
  }
  return Number(value.toFixed(precision));
}
