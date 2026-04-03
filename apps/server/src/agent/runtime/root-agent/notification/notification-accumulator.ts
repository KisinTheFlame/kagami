import { AppLogger } from "../../../../logger/logger.js";

const logger = new AppLogger({ source: "agent.notification-accumulator" });

export type NotificationEntry = {
  stateId: string;
  displayName: string;
  summary: string;
  timestamp: number;
};

type NotificationAccumulatorOptions = {
  timeWindowMs: number;
};

export class NotificationAccumulator {
  private readonly pending = new Map<string, NotificationEntry>();
  private lastFlushTime: number = Date.now();
  private readonly timeWindowMs: number;

  public constructor({ timeWindowMs }: NotificationAccumulatorOptions) {
    this.timeWindowMs = timeWindowMs;
  }

  public push(entry: NotificationEntry): void {
    this.pending.set(entry.stateId, entry);
  }

  public tryFlush(): NotificationEntry[] | null {
    if (this.pending.size === 0) {
      return null;
    }

    const now = Date.now();
    if (now - this.lastFlushTime < this.timeWindowMs) {
      return null;
    }

    const entries = [...this.pending.values()];
    this.pending.clear();
    this.lastFlushTime = now;

    logger.info("Flushed cross-state notifications", {
      count: entries.length,
      states: entries.map(e => e.stateId),
    });

    return entries;
  }

  public clearForState(stateId: string): void {
    this.pending.delete(stateId);
  }
}
