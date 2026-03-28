import type { InsertAppLogItem, LogDao } from "../dao/log.dao.js";
import type { LogEvent, LogSink } from "../types.js";

type DbLogSinkOptions = {
  logDao: LogDao;
  flushIntervalMs?: number;
  batchSize?: number;
  maxQueueSize?: number;
};

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_QUEUE_SIZE = 10_000;

export class DbLogSink implements LogSink {
  private readonly logDao: LogDao;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxQueueSize: number;
  private readonly timer: NodeJS.Timeout;
  private readonly queue: InsertAppLogItem[] = [];
  private droppedCount = 0;
  private isFlushing = false;

  public constructor(options: DbLogSinkOptions) {
    this.logDao = options.logDao;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref();
  }

  public write(event: LogEvent): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.droppedCount += 1;
      return;
    }

    if (this.droppedCount > 0) {
      process.stderr.write(
        `${JSON.stringify({
          event: "log.db_sink_queue_dropped",
          droppedCount: this.droppedCount,
          timestamp: new Date().toISOString(),
        })}\n`,
      );
      this.droppedCount = 0;
    }

    this.queue.push({
      traceId: event.traceId,
      level: event.level,
      message: event.message,
      metadata: event.metadata,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    });
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) {
      return;
    }

    this.isFlushing = true;
    try {
      while (this.queue.length > 0) {
        const items = this.queue.splice(0, this.batchSize);
        try {
          await this.logDao.insertBatch(items);
        } catch (error) {
          process.stderr.write(
            `${JSON.stringify({
              event: "log.db_sink_insert_failed",
              batchSize: items.length,
              timestamp: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
            })}\n`,
          );
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  public async close(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
