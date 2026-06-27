import type { z } from "zod";
import { ZodToolComponent } from "@kagami/agent-runtime";
import { serializeBrowserError } from "../domain/errors.js";

/**
 * Browser 子工具基类：把执行期异常用 serializeBrowserError 序列化成**冻结结构 +
 * 丰富字段**的失败结果（而非默认只回 error.message），保证主 Agent 的 tool_result
 * 形状稳定、可诊断。
 */
export abstract class BrowserToolComponent<
  TInput extends z.ZodTypeAny,
> extends ZodToolComponent<TInput> {
  protected override formatExecutionError(error: unknown): string {
    return serializeBrowserError(error);
  }
}
