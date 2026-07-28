import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import type { LogSink } from "@kagami/kernel/logger/types";

const sink: LogSink = {
  write: () => {},
};

/** 静默 sink：AlertService / handler 会记日志，测试里不需要看，但 runtime 必须先初始化。 */
export function initTestLoggerRuntime(): void {
  initLoggerRuntime({ sinks: [sink] });
}
