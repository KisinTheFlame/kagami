import type { z } from "zod";
import { ZodToolComponent } from "@kagami/agent-runtime";
import { serializePixelError } from "../domain/errors.js";

/**
 * Pixel 子工具基类：把执行期异常（服务不可达 / 无画布 render / 其它）用 serializePixelError
 * 序列化成冻结结构失败结果，保证主 Agent 的 tool_result 形状稳定。镜像 SpireToolComponent。
 *
 * 注意：领域拒绝（无效颜色 / 越界 / 无画布）不走这里——它们是 CanvasResponse 的 { ok:false }，
 * 工具据 ok 分支渲染成可读屏幕，属正常返回。
 */
export abstract class PixelToolComponent<
  TInput extends z.ZodTypeAny,
> extends ZodToolComponent<TInput> {
  protected override formatExecutionError(error: unknown): string {
    return serializePixelError(error);
  }
}
