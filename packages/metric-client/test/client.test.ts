import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import type { LogEvent, LogSink } from "@kagami/kernel/logger/types";
import { describe, expect, it, vi } from "vitest";
import { HttpMetricClient, NOOP_METRIC_CLIENT } from "../src/client.js";

/** 装一个捕获 sink，返回收集数组（每个测试各自 init）。 */
function captureLogs(): LogEvent[] {
  const logs: LogEvent[] = [];
  const sink: LogSink = {
    write(event) {
      logs.push(event);
    },
  };
  initLoggerRuntime({ sinks: [sink] });
  return logs;
}

function okResponse(body: unknown = { ok: true }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpMetricClient（包 createClient 的 fire-and-forget SDK）", () => {
  it("record 经 createClient POST，occurredAt 序列化成 ISO", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const client = new HttpMetricClient({ baseUrl: "http://127.0.0.1:20009/", fetch: fetchImpl });

    await client.record({
      metricName: "agent.tool.call",
      value: 1,
      tags: { tool: "invoke:search_web", runtime: "agent" },
      occurredAt: new Date("2026-04-01T15:00:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:20009/metric/record");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      metricName: "agent.tool.call",
      value: 1,
      tags: { tool: "invoke:search_web", runtime: "agent" },
      occurredAt: "2026-04-01T15:00:00.000Z",
    });
  });

  it("非 2xx → resolve 不抛 + warn + http_failed + status", async () => {
    const logs = captureLogs();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    const client = new HttpMetricClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchImpl });

    await expect(client.record({ metricName: "queue.depth", value: 5 })).resolves.toBeUndefined();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "warn",
      metadata: expect.objectContaining({ event: "metric.record.http_failed", status: 400 }),
    });
  });

  it("富错误信封的非 2xx 仍 warn + http_failed（验证 decodeError:()=>undefined 生效）", async () => {
    const logs = captureLogs();
    // 必须是**合法** BizErrorWire（含 name:"BizError"），否则 isBizErrorWire=false、默认解码器
    // 也返回 undefined，测试就守不住 override。合法信封 + meta 不含 reason:"bad_status"：若删掉
    // decodeError:()=>undefined，默认解码器会重建成 meta.reason≠bad_status 的 BizError → 落 error
    // 分支，本测试（期望 warn）随即变红。关掉后一律归 bad_status → warn。
    const richBody = JSON.stringify({
      error: { name: "BizError", message: "boom", statusCode: 400, meta: { code: "RATE_LIMITED" } },
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(richBody, { status: 400, headers: { "content-type": "application/json" } }),
      );
    const client = new HttpMetricClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchImpl });

    await expect(client.record({ metricName: "q", value: 1 })).resolves.toBeUndefined();

    expect(logs[0]).toMatchObject({
      level: "warn",
      metadata: expect.objectContaining({ event: "metric.record.http_failed", status: 400 }),
    });
  });

  it("2xx 但 body 非 { ok: true } → resolve + error + http_error（新行为，createClient output.parse 失败）", async () => {
    const logs = captureLogs();
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({}));
    const client = new HttpMetricClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchImpl });

    await expect(client.record({ metricName: "q", value: 1 })).resolves.toBeUndefined();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "error",
      metadata: expect.objectContaining({ event: "metric.record.http_error" }),
    });
  });

  it("Invalid Date occurredAt → resolve 不抛 + error + http_error（且不 fetch）", async () => {
    const logs = captureLogs();
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const client = new HttpMetricClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchImpl });

    // toISOString() 抛 RangeError，在 try 内被吞——否则 void record() → unhandledRejection 拉挂 agent。
    await expect(
      client.record({ metricName: "queue.depth", value: 1, occurredAt: new Date("nonsense") }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "error",
      metadata: expect.objectContaining({ event: "metric.record.http_error" }),
    });
  });

  it("网络异常 → resolve + error + http_error（原始 error 被 createClient 包成 unreachable、落 cause）", async () => {
    const logs = captureLogs();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    const client = new HttpMetricClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchImpl });

    await expect(client.record({ metricName: "queue.depth", value: 8 })).resolves.toBeUndefined();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "error",
      metadata: expect.objectContaining({
        event: "metric.record.http_error",
        error: expect.objectContaining({
          meta: expect.objectContaining({ reason: "unreachable" }),
          cause: expect.objectContaining({ message: "connect ECONNREFUSED" }),
        }),
      }),
    });
  });

  it("超时/abort（fetch 被 signal 中止）→ resolve + error + http_error", async () => {
    // 只验证「超时被吞成 http_error」；2s 具体时长是 createClient 的 timeoutMs 配置，不在此单测。
    const logs = captureLogs();
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const client = new HttpMetricClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchImpl });

    await expect(client.record({ metricName: "q", value: 1 })).resolves.toBeUndefined();

    expect(logs[0]).toMatchObject({
      level: "error",
      metadata: expect.objectContaining({ event: "metric.record.http_error" }),
    });
  });

  it("NOOP_METRIC_CLIENT.record 不做事、不抛", async () => {
    await expect(NOOP_METRIC_CLIENT.record({ metricName: "x", value: 1 })).resolves.toBeUndefined();
  });
});
