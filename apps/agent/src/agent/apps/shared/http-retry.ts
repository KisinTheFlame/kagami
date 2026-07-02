/**
 * App fetch 客户端共用的 HTTP 退避原语。HN / 高德等外部只读服务会 429/5xx，各 client
 * 的取数助手（hn-fetch / amap-fetch）都需要「可重试状态集 + 指数退避 + Retry-After 解析」
 * 这套东西。此前两处逐字节复制，收敛到这里一处维护。
 *
 * 注意：这里只放**纯退避数学**，不含各服务的 BizError 措辞与重试编排（那些与各自的错误
 * meta 约定耦合，留在各 client）。也刻意不复用 `llm-retry.ts`——那是 ReAct kernel extension，
 * 不是 HTTP retry helper。
 */

/** 只对这些状态码重试：408 超时 / 429 限流 / 5xx 服务端错误；其余 4xx 不可重试。 */
export const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** 指数退避 + 全抖动：返回 `[0, min(base·2^(attempt-1), max))` 内的随机毫秒，削平 thundering herd。 */
export function computeBackoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
  return Math.floor(Math.random() * exp);
}

/** 解析 Retry-After：纯数字按秒，HTTP 日期按到现在的差值；无法解析返回 undefined。 */
export function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
