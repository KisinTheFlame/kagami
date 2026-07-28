import type { InsertAppLogItem, LogDao } from "../dao/log.dao.js";
import type { LogEvent, LogSink } from "../types.js";

type DbLogSinkOptions = {
  logDao: LogDao;
  /** 本进程的标识，落进 `app_log.service`（#608）。 */
  service: string;
  flushIntervalMs?: number;
  batchSize?: number;
  maxQueueSize?: number;
};

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_QUEUE_SIZE = 10_000;

/**
 * 直写 DB 的日志 sink。自 #608 起唯一使用者是 observatory 自己——它持有 `app_log` 表，
 * 自身日志绝不能经 HTTP 打回自己（自噬 + 无谓回环）。其余进程一律用
 * `@kagami/observatory-client` 的 `HttpLogSink`。
 */
export class DbLogSink implements LogSink {
  private readonly logDao: LogDao;
  private readonly service: string;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxQueueSize: number;
  private readonly timer: NodeJS.Timeout;
  private readonly queue: InsertAppLogItem[] = [];
  private droppedCount = 0;
  /** 在途的那一轮 drain；null = 空闲。重入的 flush 会 await 它，而不是空转返回。 */
  private flushing: Promise<void> | null = null;

  public constructor(options: DbLogSinkOptions) {
    this.logDao = options.logDao;
    this.service = options.service;
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
      service: this.service,
      traceId: event.traceId,
      level: event.level,
      message: event.message,
      metadata: event.metadata,
      createdAt: event.createdAt,
    });
  }

  public async flush(): Promise<void> {
    if (this.flushing) {
      return this.flushing;
    }
    if (this.queue.length === 0) {
      return;
    }

    this.flushing = this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /**
   * 停 timer → 接手在途那一轮 → 排空这期间新入队的。
   *
   * 重入的 flush 必须 await 在途轮而不是空转返回，否则 close 撞上定时器那一轮会立刻返回，
   * 调用方紧接着 `closeDb()`，在途的 `insertBatch` 就写到了已断开的 Prisma client 上。
   */
  public async close(): Promise<void> {
    clearInterval(this.timer);
    await this.flushing;
    await this.flush();
  }

  private async drain(): Promise<void> {
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
  }
}
