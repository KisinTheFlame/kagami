import { BizError, type BizErrorMeta } from "@kagami/kernel/errors/biz-error";

/**
 * LLM 可重试性标记。
 *
 * 「哪次 LLM 失败可以退避重试」以前靠调用方（agent 侧）逐字匹配两条中文
 * `BizError.message` 判定——分类学的所有权（错误由本包抛出）和判定点分居两个包，靠一个
 * 魔法字符串跨 3 个包、HTTP 边界、约 19 个抛出点隐式绑定，改文案 / 漏盖新 provider 就静默
 * 退化。现在把判据下沉为本包的结构化 `meta.retryable` 布尔位，内生于错误构造工厂。
 *
 * 判据落在 `meta` 而非 message 或 error 子类，是被 wire 边界决定的：错误经
 * `toBizErrorWire → bizErrorFromWire`（见 `@kagami/kernel/errors/biz-error-wire`）跨进程往返
 * 时只重建基类 `BizError`，`instanceof 子类` 过不去，但 `meta` 会被忠实携带还原。见 issue #435。
 */

/**
 * 两条 message 保持原文导出为常量：wire 信封、日志、DB `llm_chat_call.native_error` 的字节
 * 不变，仅在 meta 上多一个 `retryable` 标记位。
 */
export const LLM_PROVIDER_UNAVAILABLE_MESSAGE = "所选 LLM provider 当前不可用";
export const LLM_UPSTREAM_CALL_FAILED_MESSAGE = "LLM 上游服务调用失败";

/**
 * provider 不可用（未配置 / 鉴权失败 / `isAvailable=false`）。盖 `retryable` 标记，
 * 供 `isRetryableLlmFailure` 判定退避重试。
 *
 * 入参形状与 `llmUpstreamCallFailedError` 对称（都是 `{ meta?, cause? }`），避免调用方把
 * 直接的 meta 与包装对象搞混——`meta` 是 `Record<string, unknown>`，误传 `{ meta: {...} }`
 * 会静默嵌套且不报类型错。
 */
export function llmProviderUnavailableError(input?: {
  meta?: BizErrorMeta;
  cause?: unknown;
}): BizError {
  return new BizError({
    message: LLM_PROVIDER_UNAVAILABLE_MESSAGE,
    meta: { ...input?.meta, retryable: true },
    ...(input?.cause === undefined ? {} : { cause: input.cause }),
  });
}

/**
 * 上游调用失败（网络异常 / 坏响应 / 空内容 / 坏工具调用）。盖 `retryable` 标记，
 * 供 `isRetryableLlmFailure` 判定退避重试。
 */
export function llmUpstreamCallFailedError(input?: {
  meta?: BizErrorMeta;
  cause?: unknown;
}): BizError {
  return new BizError({
    message: LLM_UPSTREAM_CALL_FAILED_MESSAGE,
    meta: { ...input?.meta, retryable: true },
    ...(input?.cause === undefined ? {} : { cause: input.cause }),
  });
}

/**
 * 判定一个错误是否为「可退避重试的 LLM 失败」——读结构化 `meta.retryable` 标记，
 * 不再逐字匹配 message。标记由本包的错误构造工厂盖上，能穿越 HTTP wire 往返。
 */
export function isRetryableLlmFailure(error: unknown): error is BizError {
  return error instanceof BizError && error.meta?.retryable === true;
}
