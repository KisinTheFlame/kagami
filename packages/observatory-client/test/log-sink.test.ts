import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { HttpLogSink } from "../src/log-sink.js";
import type { LogEvent } from "@kagami/kernel/logger/types";

function makeEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    traceId: "trace-1",
    level: "info",
    message: "hello",
    metadata: { source: "test" },
    createdAt: new Date("2026-07-29T00:00:00.000Z"),
    ...overrides,
  };
}

function okResponse(): Response {
  return new Response(JSON.stringify({ accepted: 1 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpLogSink", () => {
  let stderrSpy: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    vi.useFakeTimers();
    // sink 的诊断出口是 stderr；测试里静音，同时留作断言对象。
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    stderrSpy.mockRestore();
  });

  it("攒批：多条日志合成一次上报，createdAt 用产出时刻", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const sink = new HttpLogSink({
      baseUrl: "http://observatory",
      service: "agent",
      fetch: fetchImpl,
    });

    sink.write(makeEvent({ message: "a" }));
    sink.write(makeEvent({ message: "b", createdAt: new Date("2026-07-29T01:00:00.000Z") }));
    await sink.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(body.service).toBe("agent");
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ message: "a", createdAt: "2026-07-29T00:00:00.000Z" });
    expect(body.items[1]).toMatchObject({ message: "b", createdAt: "2026-07-29T01:00:00.000Z" });
  });

  it("按 batchSize 切批：超出的进下一次请求", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const sink = new HttpLogSink({
      baseUrl: "http://observatory",
      service: "agent",
      fetch: fetchImpl,
      batchSize: 2,
    });

    for (let i = 0; i < 5; i += 1) {
      sink.write(makeEvent({ message: `m${String(i)}` }));
    }
    await sink.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchImpl.mock.calls[2][1].body)).items).toHaveLength(1);
  });

  it("队列满：丢弃多余日志，并在下次写入时把丢弃数打到 stderr", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const sink = new HttpLogSink({
      baseUrl: "http://observatory",
      service: "agent",
      fetch: fetchImpl,
      maxQueueSize: 2,
    });

    sink.write(makeEvent());
    sink.write(makeEvent());
    sink.write(makeEvent()); // 被丢
    sink.write(makeEvent()); // 被丢
    await sink.flush();
    // 队列排空后再写一条，此时应把累计丢弃数报出来
    sink.write(makeEvent());

    const dropped = stderrSpy.mock.calls
      .map(call => String(call[0]))
      .find(line => line.includes("log.http_sink_queue_dropped"));
    expect(dropped).toBeDefined();
    expect(JSON.parse(dropped as string).droppedCount).toBe(2);
  });

  it("上报失败：不 throw，丢掉这批且不重试", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("observatory down"));
    const sink = new HttpLogSink({
      baseUrl: "http://observatory",
      service: "agent",
      fetch: fetchImpl,
    });

    sink.write(makeEvent());
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 队列已排空：这批被丢掉，不会在下一次 flush 里重发。
    await sink.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("失败诊断只写 stderr（自噬防线：绝不再走 AppLogger）", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("observatory down"));
    const sink = new HttpLogSink({
      baseUrl: "http://observatory",
      service: "agent",
      fetch: fetchImpl,
    });

    sink.write(makeEvent());
    await sink.flush();

    const line = stderrSpy.mock.calls
      .map(call => String(call[0]))
      .find(text => text.includes("log.http_sink_ingest_failed"));
    expect(line).toBeDefined();
    // 若失败路径走了 AppLogger，这条诊断会重新进入本 sink 的队列 → 无限自噬。
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("close：停掉定时器并排空残留队列", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const sink = new HttpLogSink({
      baseUrl: "http://observatory",
      service: "agent",
      fetch: fetchImpl,
    });

    sink.write(makeEvent());
    await sink.close();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 定时器已停：再推进时间不会有新的上报。
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("close 撞上在途 flush：等它跑完，不截断在途请求（回归 #608 review）", async () => {
    let releaseFirst: (() => void) | null = null;
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          new Promise<Response>(resolve => {
            releaseFirst = () => resolve(okResponse());
          }),
      )
      .mockResolvedValue(okResponse());
    const sink = new HttpLogSink({
      baseUrl: "http://observatory",
      service: "agent",
      fetch: fetchImpl,
      flushIntervalMs: 1000,
    });

    sink.write(makeEvent({ message: "in-flight" }));
    // 定时器起一轮 flush，卡在第一个请求上。
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 排空窗口里又来了一条（关停日志就长这样）。
    sink.write(makeEvent({ message: "during-close" }));

    let closed = false;
    const closing = sink.close().then(() => {
      closed = true;
    });

    // 在途请求没结束前，close 不该返回——早返回就等于让进程带着未送达的日志退出。
    await Promise.resolve();
    expect(closed).toBe(false);

    releaseFirst!();
    await closing;

    expect(closed).toBe(true);
    // 第二次请求把关停窗口里那条带走了。
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1].body));
    expect(secondBody.items[0].message).toBe("during-close");
  });

  it("定时器到点自动 flush", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const sink = new HttpLogSink({
      baseUrl: "http://observatory",
      service: "agent",
      fetch: fetchImpl,
      flushIntervalMs: 1000,
    });

    sink.write(makeEvent());
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
