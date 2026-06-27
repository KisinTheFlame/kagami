export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogMetadata = Record<string, unknown>;

export type LogEvent = {
  traceId: string;
  level: LogLevel;
  message: string;
  metadata: LogMetadata;
  createdAt: Date;
};

export type LogSink = {
  write(event: LogEvent): void | Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
};
