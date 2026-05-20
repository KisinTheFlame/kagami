import { z } from "zod";
import type { App, AppStartupContext } from "@kagami/agent-runtime";
import { CalculateTool } from "./tools/calculate.tool.js";

export const CALC_APP_ID = "calc";

const CalcConfigSchema = z
  .object({
    /**
     * 计算结果保留的小数位数。未配置 / null 表示不做四舍五入，直接返回 JS 浮点结果。
     * 配置后，App 内的 calculate 工具在产出 number 时会调用 toFixed(precision)
     * 再解析回 number。
     */
    precision: z.number().int().min(0).max(20).optional(),
  })
  .default({});

type CalcConfig = z.infer<typeof CalcConfigSchema>;

/**
 * Calculator App。Phase 2 验证 App 框架可行性的最小 App。
 *
 * - 无内部状态，无后台
 * - 只有一个工具 calculate(a, op, b)
 * - canInvoke 永远返回 true（App 内部没有 view，工具一直可用）
 * - 支持 `precision` 配置：作为 App 自注册 config schema 的示范，演示
 *   onStartup 把强类型 config 存进 App，再以闭包的方式喂给工具。
 */
export class CalcApp implements App<CalcConfig> {
  public readonly id = CALC_APP_ID;
  public readonly displayName = "计算器";
  public readonly configSchema = CalcConfigSchema;
  public readonly tools: readonly CalculateTool[];

  private config: CalcConfig = {};

  public constructor() {
    this.tools = [new CalculateTool({ getPrecision: () => this.config.precision })];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    const precisionLine =
      this.config.precision === undefined
        ? "结果不做小数位截断（按 JS 浮点直接返回）。"
        : `结果保留 ${this.config.precision} 位小数。`;
    return [
      "你在 calc App 里。当前可调用工具：",
      "  - calculate(a, op, b): 对两个有限实数做一次二元四则运算。op 取值: +, -, *, /",
      `  ${precisionLine}`,
      "",
      "需要复合运算（例如 1 + 2 * 3）时，按运算优先级分多次调用：",
      '  1. calculate(a=2, op="*", b=3) → 6',
      '  2. calculate(a=1, op="+", b=6) → 7',
      "",
      "调 back_to_portal 退出本 App 回到桌面。",
    ].join("\n");
  }

  public async onStartup(ctx: AppStartupContext<CalcConfig>): Promise<void> {
    this.config = ctx.config;
  }
}
