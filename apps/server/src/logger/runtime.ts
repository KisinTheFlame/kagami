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
      Promise.resolve(sink.write(event)).catch(error => {
        writeLoggerRuntimeError("log.sink_write_error", error);
      });
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
