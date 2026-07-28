import { describe, expect, it, vi } from "vitest";
import { AppLogger } from "../src/logger/logger.js";
import { addLoggerSink, initLoggerRuntime } from "../src/logger/runtime.js";
import type { LogEvent, LogSink } from "../src/logger/types.js";

function makeCapturingSink(): { sink: LogSink; events: LogEvent[] } {
  const events: LogEvent[] = [];
  return {
    sink: {
      write: event => {
        events.push(event);
      },
    },
    events,
  };
}

describe("addLoggerSink", () => {
  it("后加的 sink 收得到之后的事件，收不到之前的", () => {
    const first = makeCapturingSink();
    initLoggerRuntime({ sinks: [first.sink] });
    const logger = new AppLogger({ source: "test" });

    logger.info("before");

    const late = makeCapturingSink();
    addLoggerSink(late.sink);
    logger.info("after");

    // 这正是 runService 的启动次序：config 就绪前的 bootstrap 日志只落 stdout。
    expect(first.events.map(e => e.message)).toEqual(["before", "after"]);
    expect(late.events.map(e => e.message)).toEqual(["after"]);
  });

  it("close 会把所有 sink（含后加的）一并收口", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    initLoggerRuntime({ sinks: [] });
    addLoggerSink({ write: () => {}, close });

    const { getLoggerRuntime } = await import("../src/logger/runtime.js");
    await getLoggerRuntime().close();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("单个 sink 写失败不影响其它 sink", () => {
    const healthy = makeCapturingSink();
    initLoggerRuntime({
      sinks: [
        {
          write: () => {
            throw new Error("sink exploded");
          },
        },
        healthy.sink,
      ],
    });

    // emit 内部对每个 sink 的 write 都包了 Promise.resolve().catch，同步 throw 不该冒出来。
    expect(() => new AppLogger({ source: "test" }).info("still delivered")).not.toThrow();
    expect(healthy.events.map(e => e.message)).toEqual(["still delivered"]);
  });
});
