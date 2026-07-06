import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import type { FastifyInstance } from "fastify";
import { SchedulerRunsHandler } from "../src/http/scheduler-runs.handler.js";
import { TaskRunStore } from "../src/infra/db/task-run-store.js";
import { createTaskRunTestDb, type TaskRunTestDb } from "./helpers/task-run-db.js";

beforeAll(() => {
  initLoggerRuntime({ sinks: [{ write: () => {} }] });
});

const RUN_ID = "run-http-1";

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RUN_ID,
    ownerId: "agent",
    taskName: "ithome-poll",
    ownerGeneration: 1_700_000_000_000,
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

describe("POST /scheduler/runs", () => {
  let db: TaskRunTestDb;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = await createTaskRunTestDb();
    const store = new TaskRunStore({ database: db.database });
    app = createServiceApp({
      logger: new AppLogger({ source: "scheduler-runs-test" }),
      handlers: [new SchedulerRunsHandler({ store })],
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await db.cleanup();
  });

  it("acks and upserts idempotently across running -> success on the same run id", async () => {
    const first = await app.inject({ method: "POST", url: "/scheduler/runs", payload: body() });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true });

    const second = await app.inject({
      method: "POST",
      url: "/scheduler/runs",
      payload: body({
        status: "success",
        finishedAt: "2026-07-06T10:00:05.000Z",
        durationMs: 4000,
      }),
    });
    expect(second.statusCode).toBe(200);

    const rows = await db.database.taskRun.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("success");
    expect(rows[0]!.durationMs).toBe(4000);
  });

  it("rejects a malformed payload with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/scheduler/runs",
      payload: body({ status: "bogus" }),
    });
    expect(res.statusCode).toBe(400);
  });
});
