import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import type { FastifyInstance } from "fastify";
import { SchedulerEngine } from "../src/application/scheduler-engine.js";
import { TickBroadcaster } from "../src/application/tick-broadcaster.js";
import { SchedulerTriggerHandler } from "../src/http/scheduler-trigger.handler.js";

beforeAll(() => {
  initLoggerRuntime({ sinks: [{ write: () => {} }] });
});

/** 注册一个 owner（带 callbackBaseUrl），使 engine.getCallbackBaseUrl 有值。 */
function registerOwner(engine: SchedulerEngine, callbackBaseUrl: string): void {
  engine.register({
    ownerId: "agent",
    clientInstanceId: "c1",
    generation: 1,
    callbackBaseUrl,
    tasks: [
      { name: "ithome-poll", schedule: { kind: "interval", intervalMs: 1000 }, misfire: "latest" },
    ],
  });
}

/**
 * 造一个只认 owner callback（POST /internal/scheduler-trigger）的 fetch mock：按预设回应答体，
 * 或抛错模拟连不上。记录被打到的 URL 供断言「反向 POST 打到了 owner 的 callbackBaseUrl」。
 */
function makeCallbackFetch(
  behavior:
    | { kind: "respond"; body: unknown }
    | { kind: "throw" }
    | { kind: "bad_status"; status: number },
): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    if (behavior.kind === "throw") {
      throw new Error("ECONNREFUSED");
    }
    if (behavior.kind === "bad_status") {
      return { ok: false, status: behavior.status, json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, json: async () => behavior.body } as Response;
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function buildApp(engine: SchedulerEngine, fetchImpl: typeof fetch): FastifyInstance {
  return createServiceApp({
    logger: new AppLogger({ source: "scheduler-trigger-test" }),
    handlers: [new SchedulerTriggerHandler({ engine, fetch: fetchImpl })],
  });
}

describe("POST /scheduler/tasks/:ownerId/:taskName/trigger — unified trigger (#493 P3)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("owner_unreachable when the owner is not registered (no callbackBaseUrl)", async () => {
    const engine = new SchedulerEngine({ broadcaster: new TickBroadcaster() });
    const { fetch: f, calls } = makeCallbackFetch({
      kind: "respond",
      body: { outcome: "accepted" },
    });
    app = buildApp(engine, f);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/scheduler/tasks/agent/ithome-poll/trigger",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ outcome: "owner_unreachable" });
    // owner 未注册 → 根本不发起 callback。
    expect(calls).toHaveLength(0);
  });

  it("passes through accepted from the owner callback", async () => {
    const engine = new SchedulerEngine({ broadcaster: new TickBroadcaster() });
    const { fetch: f, calls } = makeCallbackFetch({
      kind: "respond",
      body: { outcome: "accepted" },
    });
    app = buildApp(engine, f);
    registerOwner(engine, "http://owner.local:20003");
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/scheduler/tasks/agent/ithome-poll/trigger",
    });
    expect(res.json()).toEqual({ outcome: "accepted" });
    // 反向 POST 打到了 owner 自报的 callbackBaseUrl 的回调路径。
    expect(calls[0]).toBe("http://owner.local:20003/internal/scheduler-trigger");
  });

  it("passes through rejected(unknown_task) from the owner callback", async () => {
    const engine = new SchedulerEngine({ broadcaster: new TickBroadcaster() });
    const { fetch: f } = makeCallbackFetch({
      kind: "respond",
      body: { outcome: "rejected", reason: "unknown_task" },
    });
    app = buildApp(engine, f);
    registerOwner(engine, "http://owner.local:20003");
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/scheduler/tasks/agent/ithome-poll/trigger",
    });
    expect(res.json()).toEqual({ outcome: "rejected", reason: "unknown_task" });
  });

  it("passes through rejected(overlap) from the owner callback", async () => {
    const engine = new SchedulerEngine({ broadcaster: new TickBroadcaster() });
    const { fetch: f } = makeCallbackFetch({
      kind: "respond",
      body: { outcome: "rejected", reason: "overlap" },
    });
    app = buildApp(engine, f);
    registerOwner(engine, "http://owner.local:20003");
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/scheduler/tasks/agent/ithome-poll/trigger",
    });
    expect(res.json()).toEqual({ outcome: "rejected", reason: "overlap" });
  });

  it("owner_unreachable when the callback connection fails", async () => {
    const engine = new SchedulerEngine({ broadcaster: new TickBroadcaster() });
    const { fetch: f } = makeCallbackFetch({ kind: "throw" });
    app = buildApp(engine, f);
    registerOwner(engine, "http://owner.local:20003");
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/scheduler/tasks/agent/ithome-poll/trigger",
    });
    expect(res.json()).toEqual({ outcome: "owner_unreachable" });
  });

  it("owner_unreachable when the callback returns a non-2xx status", async () => {
    const engine = new SchedulerEngine({ broadcaster: new TickBroadcaster() });
    const { fetch: f } = makeCallbackFetch({ kind: "bad_status", status: 404 });
    app = buildApp(engine, f);
    registerOwner(engine, "http://owner.local:20003");
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/scheduler/tasks/agent/ithome-poll/trigger",
    });
    expect(res.json()).toEqual({ outcome: "owner_unreachable" });
  });
});
