import { initLoggerRuntime } from "../../src/logger/runtime.js";
import type { LogEvent, LogSink } from "../../src/logger/types.js";

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
