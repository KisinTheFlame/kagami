import type { LogEvent, LogMetadata, LogSink } from "../types.js";

export class StdoutLogSink implements LogSink {
  public write(event: LogEvent): void {
    process.stdout.write(`${formatForTerminal(event)}\n`);
  }
}

function formatForTerminal(event: LogEvent): string {
  const source = getSource(event.metadata);
  const level = event.level.toUpperCase().padEnd(5, " ");
  const details = buildDetails(event);

  if (details.length === 0) {
    return `[${event.createdAt.toISOString()}] ${level} [${source}] ${event.message}`;
  }

  return `[${event.createdAt.toISOString()}] ${level} [${source}] ${event.message} | ${details.join(" ")}`;
}

function buildDetails(event: LogEvent): string[] {
  const metadata = event.metadata;
  const details: string[] = [];

  details.push(`trace=${shortTrace(event.traceId)}`);

  for (const key of ["event", "method", "url", "signal", "statusCode"] as const) {
    const value = metadata[key];
    if (isDisplayablePrimitive(value)) {
      details.push(`${key}=${String(value)}`);
    }
  }

  const errorMessage = getErrorMessage(metadata.error);
  if (errorMessage) {
    details.push(`error=${errorMessage}`);
  }

  return details;
}

function getSource(metadata: LogMetadata): string {
  const source = metadata.source;
  if (typeof source === "string" && source.length > 0) {
    return source;
  }

  return "app";
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return null;
}

function shortTrace(traceId: string): string {
  if (traceId.length <= 8) {
    return traceId;
  }

  return `${traceId.slice(0, 8)}...`;
}

function isDisplayablePrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
