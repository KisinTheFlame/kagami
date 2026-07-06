import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import type { FastifyInstance } from "fastify";
import type { SchedulerReportRunRequest } from "@kagami/scheduler-api/run";
import { SchedulerEngine } from "../src/application/scheduler-engine.js";
import { TickBroadcaster } from "../src/application/tick-broadcaster.js";
import { SchedulerRegisterHandler } from "../src/http/scheduler-register.handler.js";
import { TaskRunStore } from "../src/infra/db/task-run-store.js";
import { createTaskRunTestDb, type TaskRunTestDb } from "./helpers/task-run-db.js";

beforeAll(() => {
  initLoggerRuntime({ sinks: [{ write: () => {} }] });
});

function runningRecord(over: Partial<SchedulerReportRunRequest>): SchedulerReportRunRequest {
  return {
    id: "seed",
    ownerId: "agent",
    taskName: "ithome-poll",
    ownerGeneration: 100,
    status: "running",
    trigger: "scheduled",
    scheduledAt: "2026-07-06T10:00:00.000Z",
    startedAt: "2026-07-06T10:00:01.000Z",
    finishedAt: null,
    durationMs: null,
    error: null,
    ...over,
  };
}

function registerBody(generation: number): Record<string, unknown> {
  return {
    ownerId: "agent",
    clientInstanceId: "inst-1",
    generation,
    tasks: [
      { name: "ithome-poll", schedule: { kind: "interval", intervalMs: 1000 }, misfire: "latest" },
    ],
  };
}

describe("POST /scheduler/register — interrupted self-heal (#493 P2)", () => {
  let db: TaskRunTestDb;
  let store: TaskRunStore;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = await createTaskRunTestDb();
    store = new TaskRunStore({ database: db.database });
    const engine = new SchedulerEngine({ broadcaster: new TickBroadcaster() });
    app = createServiceApp({
      logger: new AppLogger({ source: "scheduler-register-test" }),
      handlers: [new SchedulerRegisterHandler({ engine, store })],
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await db.cleanup();
  });

  it("marks prior-generation running rows interrupted when a newer generation registers", async () => {
    await store.upsertRun(runningRecord({ id: "gen100", ownerGeneration: 100 }));

    const res = await app.inject({
      method: "POST",
      url: "/scheduler/register",
      payload: registerBody(200),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true });

    const row = (await db.database.taskRun.findMany())[0]!;
    expect(row.status).toBe("interrupted");
    expect(row.finishedAt).not.toBeNull();
  });

  it("does not heal when the register is stale (rejected)", async () => {
    // 先让 generation=200 在册。
    await app.inject({ method: "POST", url: "/scheduler/register", payload: registerBody(200) });
    await store.upsertRun(runningRecord({ id: "gen150", ownerGeneration: 150 }));

    // 迟到的 generation=100 register：被拒（stale），不触发自愈。
    const res = await app.inject({
      method: "POST",
      url: "/scheduler/register",
      payload: registerBody(100),
    });
    expect(res.json()).toMatchObject({ accepted: false });

    const row = (await db.database.taskRun.findMany())[0]!;
    expect(row.status).toBe("running");
  });
});
