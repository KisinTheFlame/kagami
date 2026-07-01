import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import type { LogEvent, LogSink } from "@kagami/kernel/logger/types";

const sink: LogSink = {
  write: () => {},
};

export function initTestLoggerRuntime(): void {
  initLoggerRuntime({ sinks: [sink] });
}

export function initTestLogger(): LogEvent[] {
  const logs: LogEvent[] = [];
  const capturingSink: LogSink = {
    write(event) {
      logs.push(event);
    },
  };

  initLoggerRuntime({ sinks: [capturingSink] });
  return logs;
}
