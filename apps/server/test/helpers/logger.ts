import { initLoggerRuntime } from "../../src/logger/runtime.js";
import type { LogSink } from "../../src/logger/types.js";

const sink: LogSink = {
  write: () => {},
};

export function initTestLoggerRuntime(): void {
  initLoggerRuntime({ sinks: [sink] });
}
