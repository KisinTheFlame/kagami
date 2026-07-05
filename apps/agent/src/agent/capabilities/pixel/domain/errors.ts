// === Pixel capability 的错误分类与稳定序列化 ===
//
// KV 缓存关键：错误消息也以 tool_result 进入主 Agent 上下文尾部、成为前缀的一部分。
// 序列化**结构冻结**（字段名 / 顺序固定）。镜像 spire / browser 的 errors.ts。
//
// 注意：领域拒绝（无效颜色 / 越界 / 无画布）走 CanvasResponse 的 { ok:false }，不是 PixelError；
// PixelError 只覆盖真正的失败——服务不可达（PIXEL_NOT_READY）、render 无画布（PIXEL_NO_CANVAS）、
// 其它异常（PIXEL_ERROR）。

export type PixelErrorCode = "PIXEL_NOT_READY" | "PIXEL_NO_CANVAS" | "PIXEL_ERROR";

export class PixelError extends Error {
  public readonly code: PixelErrorCode;

  public constructor(code: PixelErrorCode, message: string) {
    super(message);
    this.name = "PixelError";
    this.code = code;
  }
}

/**
 * 把任意错误序列化成冻结结构 JSON：{ ok:false, error:<code>, message }。
 * 非 PixelError 归一为 PIXEL_ERROR，保证主 Agent 永远拿到同形状失败结果。
 */
export function serializePixelError(error: unknown): string {
  if (error instanceof PixelError) {
    return JSON.stringify({ ok: false, error: error.code, message: error.message });
  }
  return JSON.stringify({
    ok: false,
    error: "PIXEL_ERROR" satisfies PixelErrorCode,
    message: error instanceof Error ? error.message : String(error),
  });
}
