import type { z } from "zod";
import { ZodToolComponent } from "@kagami/agent-runtime";
import { serializeGbaError } from "../domain/errors.js";

/**
 * GBA 子工具基类：把执行期异常用 serializeGbaError 序列化成冻结结构失败结果
 * （而非默认只回 error.message），保证主 Agent 的 tool_result 形状稳定、可诊断。
 * 领域拒绝（GBA_REJECTED，如后台按键 / 超帧预算）也走这里，成为一条可读的失败反馈。
 */
export abstract class GbaToolComponent<
  TInput extends z.ZodTypeAny,
> extends ZodToolComponent<TInput> {
  protected override formatExecutionError(error: unknown): string {
    return serializeGbaError(error);
  }
}
