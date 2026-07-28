import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { observatoryApiContract } from "@kagami/observatory-api/contract";
import type { IngestLogItem } from "@kagami/observatory-api/log";
import type { LogEvent, LogSink } from "@kagami/kernel/logger/types";

type HttpLogSinkOptions = {
  /** kagami-observatory 的基址。 */
  baseUrl: string;
  /** 本进程标识，落进 `app_log.service`。 */
  service: string;
  fetch?: typeof fetch;
  flushIntervalMs?: number;
  batchSize?: number;
  maxQueueSize?: number;
};

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_QUEUE_SIZE = 10_000;
/** observatory 黑洞化（接受 TCP 但不响应）时兜底，不让 pending promise 随日志频率堆积。 */
const REQUEST_TIMEOUT_MS = 2_000;

/**
 * 把日志批量上报到 kagami-observatory 的 sink（issue #608）。
 *
 * 队列语义与 `@kagami/kernel` 的 `DbLogSink` **逐条对齐**（攒批 → 定时 flush → 满队丢弃并计数），
 * 差别只在 `insertBatch` 从 Prisma 换成一次 HTTP。三条刷盘规则：
 *
 * - **不并发**：同一时刻只有一轮 drain；重入的 `flush()` 返回**在途的那个 promise**，而不是
 *   直接 resolve。这条很关键——若重入直接返回，`close()` 撞上定时器那一轮就会立刻返回，
 *   进程随后退出、截断在途的 HTTP 请求，最后一批日志静默蒸发。
 * - **失败即丢，不重试**：日志不值得为送达而堆内存或反压调用方；stdout（PM2 out.log）是兜底副本。
 * - **`close()`**：停 timer → 接手在途那一轮 → 再排空关停期间新入队的；在途请求靠 `timeoutMs`
 *   自然收敛，不额外 abort。
 *
 * **失败路径只准写 `process.stderr`，绝不准调 `AppLogger`**。否则 observatory 一挂，
 * sink 报错 → 打日志 → 进本队列 → 再上报 → 再失败，一条日志能滚成无限循环。这是本类唯一的
 * 硬性禁忌，改动时别破坏它。
 */
export class HttpLogSink implements LogSink {
  private readonly api: JsonClient<typeof observatoryApiContract>;
  private readonly service: string;
  private readonly batchSize: number;
  private readonly maxQueueSize: number;
  private readonly timer: NodeJS.Timeout;
  private readonly queue: IngestLogItem[] = [];
  private droppedCount = 0;
  /** 在途的那一轮 drain；null = 空闲。重入的 flush 会 await 它，而不是空转返回。 */
  private flushing: Promise<void> | null = null;

  public constructor(options: HttpLogSinkOptions) {
    this.service = options.service;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.api = createClient(observatoryApiContract, {
      baseUrl: options.baseUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      timeoutMs: REQUEST_TIMEOUT_MS,
      // 所有非 2xx 一律走同一条失败路径：这里不区分错误种类（都只是"这批没送到"），
      // 富错误信封解码只会白费一次 parse。
      decodeError: () => undefined,
    });

    this.timer = setInterval(() => {
      void this.flush();
    }, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  public write(event: LogEvent): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.droppedCount += 1;
      return;
    }

    if (this.droppedCount > 0) {
      writeSinkDiagnostic("log.http_sink_queue_dropped", { droppedCount: this.droppedCount });
      this.droppedCount = 0;
    }

    this.queue.push({
      traceId: event.traceId,
      level: event.level,
      message: event.message,
      metadata: event.metadata,
      // 产出时刻盖戳，不用 observatory 的到达时间——攒批 + 网络抖动会让跨进程时序失真。
      createdAt: event.createdAt.toISOString(),
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

  public async close(): Promise<void> {
    clearInterval(this.timer);
    // 两步都要：先接手可能在途的那一轮，再把这期间新入队的排空。只做后者会被在途轮短路，
    // 只做前者会漏掉排空窗口里新产生的日志（关停日志恰恰都在这个窗口里）。
    await this.flushing;
    await this.flush();
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const items = this.queue.splice(0, this.batchSize);
      try {
        await this.api.ingestLogs({ service: this.service, items });
      } catch (error) {
        // 丢掉这批，继续下一批。绝不 rethrow（调用点是 `void flush()`），绝不重试。
        writeSinkDiagnostic("log.http_sink_ingest_failed", {
          batchSize: items.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/**
 * sink 自身的诊断出口。刻意直写 stderr 而非走 AppLogger——见类注释里的自噬防线。
 * PM2 会把它收进 `<name>-error.log`。
 */
function writeSinkDiagnostic(event: string, fields: Record<string, unknown>): void {
  process.stderr.write(
    `${JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields })}\n`,
  );
}
