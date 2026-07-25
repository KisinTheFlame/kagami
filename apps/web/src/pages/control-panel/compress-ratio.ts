import {
  MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MAX,
  MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MIN,
} from "@kagami/agent-api/main-agent-context";

/** 面板默认档，与阈值触发的自动压缩同一比例（摘要前 90%，保留最近 10%）。 */
export const DEFAULT_COMPRESS_RATIO = 90;

export type CompressRatioParseFailureReason = "empty" | "not-integer" | "out-of-range";

export type CompressRatioParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: CompressRatioParseFailureReason };

/**
 * 把输入框里的原始字符串解析成合法压缩比例。区间与服务端 schema 共用
 * @kagami/agent-api 的常量，避免前后端各写一份边界。
 */
export function parseCompressRatio(raw: string): CompressRatioParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, reason: "empty" };
  }

  // Number("") / Number(" ") 是 0，前面已挡掉；这里只需再挡非数字与非整数。
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, reason: "not-integer" };
  }

  const value = Number(trimmed);
  if (
    value < MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MIN ||
    value > MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MAX
  ) {
    return { ok: false, reason: "out-of-range" };
  }

  return { ok: true, value };
}

export function describeCompressRatioError(reason: CompressRatioParseFailureReason): string {
  switch (reason) {
    case "empty":
      return "请填写压缩比例";
    case "not-integer":
      return "压缩比例必须是整数";
    case "out-of-range":
      return `压缩比例需在 ${String(MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MIN)}~${String(MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MAX)} 之间`;
  }
}
