/** 同一 `(source, event)` 的去重窗口长度。代码常量：不随环境变，运维不会在线上调它。 */
const ALERT_DEDUPE_WINDOW_MS = 300_000;

/** 窗口结束后再保留多久才清理该键（防调用方乱传 event 把 Map 撑爆）。 */
const KEY_RETENTION_AFTER_WINDOW_MS = 3_600_000;

export type ThrottleDecision =
  | {
      admit: true;
      /** 上一次放行之后被压制的次数（放行时归零）。 */
      suppressedSinceLast: number;
    }
  | { admit: false };

type WindowState = {
  windowStartedAt: number;
  suppressedCount: number;
};

/**
 * 告警去重限流的纯状态机（进程内存，零 DB）。
 *
 * 语义：
 * - 键 = `${source}::${event}`。
 * - 窗口内首条放行并开窗；窗口内后续同键累加 `suppressedCount` 且不放行。
 * - 边界取 `>=`：`now - windowStartedAt >= ALERT_DEDUPE_WINDOW_MS` 即视为窗口已结束、开新窗放行。
 * - **窗口以「尝试投递」为界，不以「投递成功」为界**：调用方拿到 admit 后即使投递失败，窗口
 *   照样已开。取舍理由——napcat 持续不可用时不该每次调用都重打它把它压得更死；而且上报方本地
 *   日志已无条件留痕，丢的只是 5 分钟内的 QQ 推送，不是告警本身。
 *
 * 时间基准由构造注入（`now`），单测用 fake now，不用真时钟。
 */
export class AlertThrottle {
  private readonly windows = new Map<string, WindowState>();
  private readonly windowMs: number;
  private readonly now: () => Date;

  public constructor({ now, windowMs }: { now?: () => Date; windowMs?: number } = {}) {
    this.now = now ?? (() => new Date());
    this.windowMs = windowMs ?? ALERT_DEDUPE_WINDOW_MS;
  }

  public admit(input: { source: string; event: string }): ThrottleDecision {
    const nowMs = this.now().getTime();
    this.pruneExpired(nowMs);

    const key = `${input.source}::${input.event}`;
    const state = this.windows.get(key);
    if (state && nowMs - state.windowStartedAt < this.windowMs) {
      state.suppressedCount += 1;
      return { admit: false };
    }

    const suppressedSinceLast = state?.suppressedCount ?? 0;
    this.windows.set(key, { windowStartedAt: nowMs, suppressedCount: 0 });
    return { admit: true, suppressedSinceLast };
  }

  private pruneExpired(nowMs: number): void {
    for (const [key, state] of this.windows) {
      if (state.windowStartedAt + this.windowMs + KEY_RETENTION_AFTER_WINDOW_MS < nowMs) {
        this.windows.delete(key);
      }
    }
  }
}
