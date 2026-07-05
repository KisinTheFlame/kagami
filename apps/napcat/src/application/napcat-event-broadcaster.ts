import { AppLogger } from "@kagami/kernel/logger/logger";
import { NAPCAT_SSE_HEARTBEAT_MS, type NapcatOutboxEvent } from "@kagami/napcat-api/event";

const logger = new AppLogger({ source: "napcat.event-broadcaster" });

/**
 * 一个 SSE 订阅者（一条活连接）。广播器只认这个接口，序列化 / 回放交接 / 断开检测都由具体
 * 实现（endpoint 侧的 {@link NapcatSseSubscriber}）负责。
 */
export type NapcatEventSubscriber = {
  /** 收到一个已落 outbox 的实时事件。 */
  deliver(outboxEvent: NapcatOutboxEvent): void;
  /** 心跳注释帧，用于对端半开检测。 */
  heartbeat(): void;
  /** 关停时主动结束底层连接（end res），让 app.close() 不必等 keep-alive 长连接超时。 */
  close(): void;
};

/**
 * napcat → agent 入站事件的 SSE 广播器：持有当前所有活订阅者，把「先落 outbox 拿到 seq」的
 * 事件实时 `deliver` 给它们；另起 15s 心跳。它只管「实时扇出」；重连缺口回放与去重交接由订阅者
 * 自己在 attach 后处理（先缓冲实时、回放 outbox、再 flush 缓冲、转实时）——避免单调游标下
 * live 高 seq 抢先推进游标、把尚未回放的低 seq 误当重复丢弃。
 *
 * 单进程内存组件，无持久状态——outbox 才是事实源。
 */
export class NapcatEventBroadcaster {
  private readonly subscribers = new Set<NapcatEventSubscriber>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** 注册一条活连接。首个订阅者进来时启动心跳。 */
  public add(subscriber: NapcatEventSubscriber): void {
    this.subscribers.add(subscriber);
    if (this.heartbeatTimer === null) {
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), NAPCAT_SSE_HEARTBEAT_MS);
      this.heartbeatTimer.unref?.();
    }
  }

  /** 摘除一条连接（socket close / 写失败时）。最后一条走后停心跳。 */
  public remove(subscriber: NapcatEventSubscriber): void {
    this.subscribers.delete(subscriber);
    if (this.subscribers.size === 0 && this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 关停时结束所有活连接：逐个 close（end res），清空订阅集、停心跳。没有这一步，hijack 的
   * keep-alive SSE 长连接会让 `app.close()` 挂到强退超时（issue #425）。close 触发的 res "close"
   * 事件还会各自回调 remove（幂等）。
   */
  public closeAll(): void {
    for (const subscriber of [...this.subscribers]) {
      this.safe(subscriber, () => subscriber.close());
    }
    this.subscribers.clear();
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 把一个已落 outbox 的事件实时扇出给所有活订阅者。 */
  public publish(outboxEvent: NapcatOutboxEvent): void {
    for (const subscriber of this.subscribers) {
      this.safe(subscriber, () => subscriber.deliver(outboxEvent));
    }
  }

  private sendHeartbeat(): void {
    for (const subscriber of this.subscribers) {
      this.safe(subscriber, () => subscriber.heartbeat());
    }
  }

  private safe(subscriber: NapcatEventSubscriber, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      // 写失败（对端已断但 close 事件还没到）：摘掉它，避免反复报错。
      this.subscribers.delete(subscriber);
      logger.warn("SSE subscriber failed, dropped", {
        event: "napcat.sse.subscriber_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** 一个事件序列化成 SSE 帧：`id: <seq>\ndata: <event JSON>\n\n`。 */
export function serializeEventFrame(outboxEvent: NapcatOutboxEvent): string {
  return `id: ${outboxEvent.seq}\ndata: ${JSON.stringify(outboxEvent.event)}\n\n`;
}
