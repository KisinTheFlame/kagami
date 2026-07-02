// === Spire capability 的错误分类与稳定序列化 ===
//
// KV 缓存关键：错误消息也以 tool_result 进入主 Agent 上下文尾部、成为前缀的一部分。
// 序列化**结构冻结**（字段名 / 顺序固定），字段本身可带诊断信息。镜像 browser 的 errors.ts。

export type SpireErrorCode = "SPIRE_NOT_READY" | "SPIRE_REJECTED" | "SPIRE_ERROR";

export class SpireError extends Error {
  public readonly code: SpireErrorCode;

  public constructor(code: SpireErrorCode, message: string) {
    super(message);
    this.name = "SpireError";
    this.code = code;
  }
}

/**
 * 把任意错误序列化成冻结结构 JSON：{ ok:false, error:<code>, message }。
 * 非 SpireError 归一为 SPIRE_ERROR，保证主 Agent 永远拿到同形状失败结果。
 */
export function serializeSpireError(error: unknown): string {
  if (error instanceof SpireError) {
    return JSON.stringify({ ok: false, error: error.code, message: error.message });
  }
  return JSON.stringify({
    ok: false,
    error: "SPIRE_ERROR" satisfies SpireErrorCode,
    message: error instanceof Error ? error.message : String(error),
  });
}
