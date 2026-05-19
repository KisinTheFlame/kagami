import type { App } from "@kagami/agent-runtime";
import { CalculateTool } from "./tools/calculate.tool.js";

export const CALC_APP_ID = "calc";

/**
 * Calculator App。Phase 2 验证 App 框架可行性的最小 App。
 *
 * - 无状态，无后台，无生命周期工作
 * - 只有一个工具 calculate(a, op, b)
 * - canInvoke 永远返回 true（App 内部没有 view，工具一直可用）
 */
export class CalcApp implements App {
  public readonly id = CALC_APP_ID;
  public readonly displayName = "计算器";
  public readonly tools = [new CalculateTool()];

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return [
      "你在 calc App 里。当前可调用工具：",
      "  - calculate(a, op, b): 对两个有限实数做一次二元四则运算。op 取值: +, -, *, /",
      "",
      "需要复合运算（例如 1 + 2 * 3）时，按运算优先级分多次调用：",
      '  1. calculate(a=2, op="*", b=3) → 6',
      '  2. calculate(a=1, op="+", b=6) → 7',
      "",
      "调 back_to_portal 退出本 App 回到桌面。",
    ].join("\n");
  }
}
