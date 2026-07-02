import { BizError } from "@kagami/kernel/errors/biz-error";
import {
  RETRYABLE_STATUS,
  computeBackoffMs,
  parseRetryAfter,
  sleep,
} from "../../shared/http-retry.js";

/**
 * Hacker News 两个只读 API（Firebase + Algolia）共用的 HTTP 取数助手。
 *
 * ithome 的 client 用裸 fetch + 失败即抛，没有退避；HN 是外部公共服务、会 429/5xx，
 * 所以这里叠一层 HTTP 退避。退避原语（可重试状态集 / 指数退避 / Retry-After 解析）走
 * 共享的 `apps/shared/http-retry`，本文件只保留 HN 专属的错误 meta 与重试编排。
 *
 * 退避策略：
 *   - 只对 429 / 408 / 5xx / 网络错误 / 超时重试；其余 4xx 直接抛（不可重试）。
 *   - 优先尊重 `Retry-After`（秒数或 HTTP 日期）；否则指数退避 + 抖动。
 *   - 每次请求用 `AbortSignal.timeout` 限时。
 *   - 重试耗尽抛 BizError（沿用 ithome 的 `meta: { reason, status }` 约定）。
 */

export type HnFetchOptions = {
  userAgent: string;
  /** 单次请求超时（ms）。 */
  timeoutMs: number;
  /** 最大尝试次数（含首次）。 */
  maxAttempts: number;
  /** 指数退避基数（ms）。 */
  backoffBaseMs: number;
  /** 退避上限（ms）。 */
  backoffMaxMs: number;
};

/**
 * 取一个 JSON 端点并返回 `unknown`（调用方用 zod 宽松解析，本助手不假设形状）。
 * Firebase 对不存在的 item 返回字面量 `null`（合法），照常返回交给上层处理。
 */
export async function hnFetchJson(url: string, options: HnFetchOptions): Promise<unknown> {
  const { userAgent, timeoutMs, maxAttempts, backoffBaseMs, backoffMaxMs } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // 网络错误 / 超时（AbortError）→ 可重试。
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(computeBackoffMs(attempt, backoffBaseMs, backoffMaxMs));
        continue;
      }
      throw new BizError({
        message: "拉取 Hacker News 失败（网络错误或超时）",
        meta: { reason: "HN_FETCH_NETWORK_ERROR", url, attempts: attempt },
        cause: error,
      });
    }

    if (response.ok) {
      try {
        return (await response.json()) as unknown;
      } catch (error) {
        // 坏 JSON 不重试——重试也是同样的坏响应。
        throw new BizError({
          message: "Hacker News 返回了无法解析的 JSON",
          meta: { reason: "HN_FETCH_BAD_JSON", url, status: response.status },
          cause: error,
        });
      }
    }

    if (!RETRYABLE_STATUS.has(response.status) || attempt >= maxAttempts) {
      throw new BizError({
        message: `拉取 Hacker News 失败（HTTP ${response.status}）`,
        meta: { reason: "HN_FETCH_HTTP_ERROR", url, status: response.status, attempts: attempt },
      });
    }

    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    await sleep(retryAfterMs ?? computeBackoffMs(attempt, backoffBaseMs, backoffMaxMs));
  }

  // 理论不可达（循环内要么 return 要么 throw），保险起见兜底。
  throw new BizError({
    message: "拉取 Hacker News 失败（重试耗尽）",
    meta: { reason: "HN_FETCH_EXHAUSTED", url },
    cause: lastError,
  });
}
