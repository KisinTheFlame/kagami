import { getLoggerRuntime } from "./runtime.js";
import { serializeError, serializeMetadata } from "./serializer.js";
import type { LogLevel, LogMetadata } from "./types.js";

type AppLoggerOptions = {
  source: string;
};

export class AppLogger {
  private readonly source: string;

  public constructor({ source }: AppLoggerOptions) {
    this.source = source;
  }

  public debug(message: string, metadata: LogMetadata = {}): void {
    this.log("debug", message, metadata);
  }

  public info(message: string, metadata: LogMetadata = {}): void {
    this.log("info", message, metadata);
  }

  public warn(message: string, metadata: LogMetadata = {}): void {
    this.log("warn", message, metadata);
  }

  public error(message: string, metadata: LogMetadata = {}): void {
    this.log("error", message, metadata);
  }

  public fatal(message: string, metadata: LogMetadata = {}): void {
    this.log("fatal", message, metadata);
  }

  public errorWithCause(message: string, error: unknown, metadata: LogMetadata = {}): void {
    this.log("error", message, {
      ...metadata,
      error: serializeError(error),
    });
  }

  private log(level: LogLevel, message: string, metadata: LogMetadata): void {
    const runtime = getLoggerRuntime();
    runtime.emit({
      level,
      message,
      metadata: serializeMetadata({
        source: this.source,
        ...metadata,
      }),
    });
  }
}
