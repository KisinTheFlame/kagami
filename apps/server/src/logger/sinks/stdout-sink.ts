import type { LogEvent, LogSink } from "../types.js";

export class StdoutLogSink implements LogSink {
  public write(event: LogEvent): void {
    process.stdout.write(`${JSON.stringify(toOutputEvent(event))}\n`);
  }
}

function toOutputEvent(event: LogEvent): Record<string, unknown> {
  return {
    traceId: event.traceId,
    level: event.level,
    message: event.message,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
  };
}
