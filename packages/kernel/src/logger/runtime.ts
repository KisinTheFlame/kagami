import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { LogEvent, LogLevel, LogMetadata, LogSink } from "./types.js";

type TraceContext = {
  traceId: string;
};

type InitLoggerRuntimeOptions = {
  sinks: LogSink[];
};

type EmitLogInput = {
  level: LogLevel;
  message: string;
  metadata: LogMetadata;
};

class LoggerRuntime {
  private readonly sinks: LogSink[];

  public constructor({ sinks }: InitLoggerRuntimeOptions) {
    this.sinks = sinks;
  }

  public addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  public emit(input: EmitLogInput): void {
    const traceId = getTraceContext()?.traceId ?? randomUUID();
    const event: LogEvent = {
      traceId,
      level: input.level,
      message: input.message,
      metadata: input.metadata,
      createdAt: new Date(),
    };

    for (const sink of this.sinks) {
      // try/catch 包同步段是必须的：`Promise.resolve(sink.write(...))` 只接得住 **异步** 失败，
      // sink.write 同步 throw 会在 Promise 构造之前就冒出去，把调用方的控制流一起打断——
      // 一次记日志绝不该杀掉正在做正事的那条路径。
      try {
        Promise.resolve(sink.write(event)).catch(error => {
          writeLoggerRuntimeError("log.sink_write_error", error);
        });
      } catch (error) {
        writeLoggerRuntimeError("log.sink_write_error", error);
      }
    }
  }

  public async flush(): Promise<void> {
    await Promise.all(
      this.sinks.map(async sink => {
        if (!sink.flush) {
          return;
        }

        try {
          await sink.flush();
        } catch (error) {
          writeLoggerRuntimeError("log.sink_flush_error", error);
        }
      }),
    );
  }

  public async close(): Promise<void> {
    await Promise.all(
      this.sinks.map(async sink => {
        if (!sink.close) {
          return;
        }

        try {
          await sink.close();
        } catch (error) {
          writeLoggerRuntimeError("log.sink_close_error", error);
        }
      }),
    );
  }
}

const traceContextStorage = new AsyncLocalStorage<TraceContext>();

let runtime: LoggerRuntime | null = null;

export function initLoggerRuntime(options: InitLoggerRuntimeOptions): void {
  runtime = new LoggerRuntime(options);
}

export function getLoggerRuntime(): LoggerRuntime {
  if (runtime === null) {
    throw new Error("Logger runtime is not initialized");
  }

  return runtime;
}

/**
 * 运行时追加一个 sink（issue #608）。
 *
 * 为什么需要「后加」而不是 init 时一次给全：日志上报 sink（`HttpLogSink`）的 baseUrl 要从
 * config 读，而 config 加载是异步的，`runService` 却必须在 `await build()` **之前**就把
 * 日志运行时立起来（否则 build 期间的日志无处可去）。于是分两步：init 只给 stdout，
 * 配置就绪后再 addLoggerSink。代价是启动最早期的几条 bootstrap 日志只落 stdout——
 * 那几条的读者本来就是 PM2 out.log。
 *
 * 只增不减：没有 removeSink。sink 的生命周期由持有方经 `close()` 收口（`runService` 会把它
 * 挂进 cleanup），不做运行期热插拔。
 */
export function addLoggerSink(sink: LogSink): void {
  getLoggerRuntime().addSink(sink);
}

export function withTraceContext<T>(traceId: string, callback: () => T): T {
  return traceContextStorage.run({ traceId }, callback);
}

export function getTraceContext(): TraceContext | null {
  return traceContextStorage.getStore() ?? null;
}

function writeLoggerRuntimeError(event: string, error: unknown): void {
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };

  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
