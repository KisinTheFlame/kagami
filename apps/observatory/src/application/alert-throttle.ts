/** 同一 `(source, event)` 的去重窗口长度。代码常量：不随环境变，运维不会在线上调它。 */
const ALERT_DEDUPE_WINDOW_MS = 300_000;

/** 窗口结束后再保留多久才清理该键。 */
const KEY_RETENTION_AFTER_WINDOW_MS = 3_600_000;

/**
 * 同时追踪的键数硬上限。(source, event) 本该是开发者写死的少数几个值，但坏调用方可能把唯一 ID
 * 塞进 event（如 `react.stall.<uuid>`）——只靠时间清理挡不住：一小时内涌进来的高基数键全都还在。
 * 超过上限就按「最久没开窗」的顺序淘汰，把内存和扫描代价一起钉死。
 */
const MAX_TRACKED_KEYS = 1024;

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
 * - 键 = `(source, event)`，用长度前缀编码防歧义碰撞（见 `createWindowKey`）。
 * - 窗口内首条放行并开窗；窗口内后续同键累加 `suppressedCount` 且不放行。
 * - 追踪的键数有硬上限，超限按 LRU 淘汰（见 `enforceCapacity`）——不然坏调用方把唯一 ID 塞进
 *   `event` 就能把内存和扫描代价推到无界。
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
  private readonly maxTrackedKeys: number;
  private readonly now: () => Date;

  public constructor({
    now,
    windowMs,
    maxTrackedKeys,
  }: { now?: () => Date; windowMs?: number; maxTrackedKeys?: number } = {}) {
    this.now = now ?? (() => new Date());
    this.windowMs = windowMs ?? ALERT_DEDUPE_WINDOW_MS;
    this.maxTrackedKeys = maxTrackedKeys ?? MAX_TRACKED_KEYS;
  }

  public admit(input: { source: string; event: string }): ThrottleDecision {
    const nowMs = this.now().getTime();

    const key = createWindowKey(input);
    const state = this.windows.get(key);
    if (state && nowMs - state.windowStartedAt < this.windowMs) {
      state.suppressedCount += 1;
      return { admit: false };
    }

    const suppressedSinceLast = state?.suppressedCount ?? 0;
    // delete 再 set：让 Map 的插入顺序等于「最近一次开窗」的顺序，淘汰时才能真按 LRU 走
    //（Map.set 命中已存在的键不会把它移到末尾）。
    this.windows.delete(key);
    this.windows.set(key, { windowStartedAt: nowMs, suppressedCount: 0 });
    this.enforceCapacity(nowMs);
    return { admit: true, suppressedSinceLast };
  }

  /**
   * 容量与 CPU 的双重封顶。只在键数越过上限时才扫全表（摊还 O(1)，不是每次 admit 都 O(n)）：
   * 先清过期键，仍超限就按最久没开窗的顺序淘汰到上限。
   *
   * 淘汰一个键的后果只是「它的压制计数丢了、下次上报会被当首条放行」——比让进程被高基数键
   * 拖死好得多。
   */
  private enforceCapacity(nowMs: number): void {
    if (this.windows.size <= this.maxTrackedKeys) {
      return;
    }

    for (const [key, state] of this.windows) {
      if (state.windowStartedAt + this.windowMs + KEY_RETENTION_AFTER_WINDOW_MS < nowMs) {
        this.windows.delete(key);
      }
    }

    // Map 迭代按插入顺序，上面的 delete-then-set 保证了它就是开窗时间顺序：从头删即最久未开窗。
    for (const key of this.windows.keys()) {
      if (this.windows.size <= this.maxTrackedKeys) {
        break;
      }

      this.windows.delete(key);
    }
  }
}

/**
 * 复合键。用长度前缀而不是裸 `source::event` 拼接：后者会让 `("a::b", "c")` 与 `("a", "b::c")`
 * 塌成同一个键，两个无关告警互相压制（契约不禁止字段里出现 `::`）。
 */
function createWindowKey(input: { source: string; event: string }): string {
  return `${input.source.length}:${input.source}:${input.event}`;
}
