import { AppLogger } from "@kagami/kernel/logger/logger";
import { SCHEDULER_SSE_HEARTBEAT_MS, type SchedulerTickEvent } from "@kagami/scheduler-api/event";

const logger = new AppLogger({ source: "scheduler.tick-broadcaster" });

/** 一条活 SSE 连接。广播器只认这个接口，写帧 / 心跳由 endpoint 侧具体实现。 */
export type TickSubscriber = {
  write(chunk: string): void;
  heartbeat(): void;
};

/**
 * 调度器 → 使用方 tick 的 SSE 广播器（issue #428）：按 ownerId 分组持有活订阅者，把一个 tick 只
 * 扇出给该 owner 名下的连接。纯内存、无持久状态——tick 是派生事实，断连的补偿走引擎的 pending
 * 合并（misfire），不做 outbox 回放。另起 15s 心跳供对端半开检测。
 */
export class TickBroadcaster {
  private readonly subscribers = new Map<string, Set<TickSubscriber>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  public add(ownerId: string, subscriber: TickSubscriber): void {
    let set = this.subscribers.get(ownerId);
    if (!set) {
      set = new Set();
      this.subscribers.set(ownerId, set);
    }
    set.add(subscriber);
    if (this.heartbeatTimer === null) {
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), SCHEDULER_SSE_HEARTBEAT_MS);
      this.heartbeatTimer.unref?.();
    }
  }

  public remove(ownerId: string, subscriber: TickSubscriber): void {
    const set = this.subscribers.get(ownerId);
    if (set) {
      set.delete(subscriber);
      if (set.size === 0) {
        this.subscribers.delete(ownerId);
      }
    }
    if (this.totalSubscribers() === 0 && this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public hasSubscriber(ownerId: string): boolean {
    const set = this.subscribers.get(ownerId);
    return set !== undefined && set.size > 0;
  }

  /** 把一个 tick 扇出给该 owner 名下所有活连接；返回是否至少投递给了一个连接。 */
  public deliver(ownerId: string, tick: SchedulerTickEvent): boolean {
    const set = this.subscribers.get(ownerId);
    if (!set || set.size === 0) {
      return false;
    }
    const frame = serializeTickFrame(tick);
    let delivered = false;
    for (const subscriber of [...set]) {
      if (this.safe(ownerId, subscriber, () => subscriber.write(frame))) {
        delivered = true;
      }
    }
    return delivered;
  }

  private sendHeartbeat(): void {
    for (const [ownerId, set] of this.subscribers) {
      for (const subscriber of [...set]) {
        this.safe(ownerId, subscriber, () => subscriber.heartbeat());
      }
    }
  }

  private safe(ownerId: string, subscriber: TickSubscriber, fn: () => void): boolean {
    try {
      fn();
      return true;
    } catch (error) {
      this.remove(ownerId, subscriber);
      logger.warn("SSE subscriber failed, dropped", {
        event: "scheduler.sse.subscriber_failed",
        ownerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private totalSubscribers(): number {
    let total = 0;
    for (const set of this.subscribers.values()) {
      total += set.size;
    }
    return total;
  }
}

/** 一个 tick 序列化成 SSE 帧：`data: <tick JSON>\n\n`（无 id 行——不做 Last-Event-ID 回放）。 */
export function serializeTickFrame(tick: SchedulerTickEvent): string {
  return `data: ${JSON.stringify(tick)}\n\n`;
}
