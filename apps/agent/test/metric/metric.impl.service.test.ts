import { describe, expect, it, vi } from "vitest";
import { HttpMetricService } from "../../src/metric/application/metric.impl.service.js";
import { initTestLogger } from "../helpers/logger.js";

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("HttpMetricService", () => {
  it("should POST the record with occurredAt serialized to ISO", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const service = new HttpMetricService({ baseUrl: "http://127.0.0.1:20009/", fetch: fetchImpl });
    const occurredAt = new Date("2026-04-01T15:00:00.000Z");

    await service.record({
      metricName: "agent.tool.call",
      value: 1,
      tags: { tool: "invoke:search_web", runtime: "agent" },
      occurredAt,
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

  it("should swallow a non-2xx response without throwing", async () => {
    const logs = initTestLogger();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    const service = new HttpMetricService({ baseUrl: "http://127.0.0.1:20009", fetch: fetchImpl });

    await expect(service.record({ metricName: "queue.depth", value: 5 })).resolves.toBeUndefined();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "warn",
      metadata: expect.objectContaining({
        event: "metric.record.http_failed",
        status: 400,
      }),
    });
  });

  it("should swallow an Invalid Date occurredAt without throwing", async () => {
    const logs = initTestLogger();
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const service = new HttpMetricService({ baseUrl: "http://127.0.0.1:20009", fetch: fetchImpl });

    // Invalid Date：`toISOString()` 抛 RangeError，必须被咽下（否则 void fire-and-forget 会
    // 变成 unhandledRejection 拉挂 agent）。
    await expect(
      service.record({ metricName: "queue.depth", value: 1, occurredAt: new Date("nonsense") }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "error",
      metadata: expect.objectContaining({ event: "metric.record.http_error" }),
    });
  });

  it("should swallow a network error without throwing", async () => {
    const logs = initTestLogger();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    const service = new HttpMetricService({ baseUrl: "http://127.0.0.1:20009", fetch: fetchImpl });

    await expect(service.record({ metricName: "queue.depth", value: 8 })).resolves.toBeUndefined();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "error",
      metadata: expect.objectContaining({
        event: "metric.record.http_error",
        error: expect.objectContaining({ message: "connect ECONNREFUSED" }),
      }),
    });
  });
});
