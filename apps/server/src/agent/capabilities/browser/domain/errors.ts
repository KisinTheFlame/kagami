/**
 * Browser capability 的错误分类与稳定序列化。
 *
 * KV 缓存关键：错误消息也会以 tool_result 进入主 Agent 上下文尾部、成为前缀的一部分。
 * 所以序列化**结构冻结**（字段名 / 顺序固定），但字段本身**丰富**（带 url / pageId /
 * ref / epoch / locatorState），避免线上不可诊断。冻结结构 ≠ 字段贫血。
 *
 * 设计依据：eng-review「错误序列化」决策（Codex 点8）。
 */

export type BrowserErrorCode =
  | "BROWSER_NOT_READY"
  | "NAVIGATION_FAILED"
  | "ACTION_TIMEOUT"
  | "STALE_REF"
  | "ELEMENT_NOT_ACTIONABLE"
  | "TARGET_CLOSED"
  | "EVAL_FAILED"
  | "SCREENSHOT_REFUSED"
  | "CREDENTIAL_NOT_FOUND"
  | "BROWSER_ERROR";

/** 错误附带的诊断上下文。全可选；序列化时只输出有值的字段（顺序固定）。 */
export type BrowserErrorContext = {
  url?: string;
  pageId?: string;
  ref?: string;
  epoch?: number;
  currentEpoch?: number;
  locatorState?: string;
  navigating?: boolean;
};

const CONTEXT_FIELD_ORDER: readonly (keyof BrowserErrorContext)[] = [
  "url",
  "pageId",
  "ref",
  "epoch",
  "currentEpoch",
  "locatorState",
  "navigating",
];

export class BrowserError extends Error {
  public readonly code: BrowserErrorCode;
  public readonly contextInfo: BrowserErrorContext;

  public constructor(
    code: BrowserErrorCode,
    message: string,
    contextInfo: BrowserErrorContext = {},
  ) {
    super(message);
    this.name = "BrowserError";
    this.code = code;
    this.contextInfo = contextInfo;
  }
}

/**
 * 把任意错误序列化成冻结结构的 JSON 字符串。字段顺序固定：
 * { ok:false, error:<code>, message, context:{...按 CONTEXT_FIELD_ORDER} }。
 * 非 BrowserError 归一为 BROWSER_ERROR，保证主 Agent 永远拿到同形状的失败结果。
 */
export function serializeBrowserError(error: unknown): string {
  if (error instanceof BrowserError) {
    const orderedContext: Record<string, unknown> = {};
    for (const key of CONTEXT_FIELD_ORDER) {
      const value = error.contextInfo[key];
      if (value !== undefined) {
        orderedContext[key] = value;
      }
    }
    return JSON.stringify({
      ok: false,
      error: error.code,
      message: error.message,
      context: orderedContext,
    });
  }

  return JSON.stringify({
    ok: false,
    error: "BROWSER_ERROR" satisfies BrowserErrorCode,
    message: error instanceof Error ? error.message : String(error),
    context: {},
  });
}
