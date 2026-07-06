import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import type { SchedulerTasksViewResponse } from "@kagami/scheduler-api/tasks-view";
import type { FastifyInstance } from "fastify";
import { SchedulerEngine } from "../src/application/scheduler-engine.js";
import { TickBroadcaster } from "../src/application/tick-broadcaster.js";
import { SchedulerTasksViewHandler } from "../src/http/scheduler-tasks-view.handler.js";
import { TaskRunStore } from "../src/infra/db/task-run-store.js";
import { createTaskRunTestDb, type TaskRunTestDb } from "./helpers/task-run-db.js";

beforeAll(() => {
  initLoggerRuntime({ sinks: [{ write: () => {} }] });
});

/** 注册一个 owner 的一组活任务（interval，misfire latest）到 engine。 */
function registerOwner(engine: SchedulerEngine, ownerId: string, taskNames: string[]): void {
  engine.register({
    ownerId,
    clientInstanceId: `${ownerId}-c1`,
    generation: 1,
    callbackBaseUrl: `http://${ownerId}.local:20003`,
    tasks: taskNames.map(name => ({
      name,
      schedule: { kind: "interval" as const, intervalMs: 60_000 },
      misfire: "latest" as const,
    })),
  });
}

describe("GET /scheduler/tasks — global view (#493 P4)", () => {
  let db: TaskRunTestDb;
  let store: TaskRunStore;
  let engine: SchedulerEngine;
  let app: FastifyInstance;

  beforeEach(async () => {
    // fake timers 让 interval driver 不真实 fire；只关心 nextRunAt 派生与拼装。
    vi.useFakeTimers();
    db = await createTaskRunTestDb();
    store = new TaskRunStore({ database: db.database });
    engine = new SchedulerEngine({ broadcaster: new TickBroadcaster() });
    app = createServiceApp({
      logger: new AppLogger({ source: "scheduler-tasks-view-test" }),
      handlers: [new SchedulerTasksViewHandler({ engine, store })],
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    engine.stop();
    await db.cleanup();
    vi.useRealTimers();
  });

  async function fetchTasks(): Promise<SchedulerTasksViewResponse> {
    const res = await app.inject({ method: "GET", url: "/scheduler/tasks" });
    expect(res.statusCode).toBe(200);
    return res.json() as SchedulerTasksViewResponse;
  }

  it("returns empty tasks when no owner is registered", async () => {
    expect((await fetchTasks()).tasks).toEqual([]);
  });

  it("lists active tasks across all owners (cross-owner)", async () => {
    registerOwner(engine, "agent", ["taskA"]);
    registerOwner(engine, "napcat", ["taskB"]);

    const { tasks } = await fetchTasks();
    const byOwner = new Map(tasks.map(t => [`${t.ownerId}/${t.name}`, t]));
    expect(byOwner.has("agent/taskA")).toBe(true);
    expect(byOwner.has("napcat/taskB")).toBe(true);
    expect(tasks).toHaveLength(2);
  });

  it("left-joins: an active task with no history gets empty recentRuns and isRunning=false", async () => {
    registerOwner(engine, "agent", ["taskA"]);
    const { tasks } = await fetchTasks();
    const task = tasks.find(t => t.name === "taskA")!;
    expect(task.recentRuns).toEqual([]);
    expect(task.isRunning).toBe(false);
    // schedule + nextRunAt 来自 engine（活任务侧）。
    expect(task.schedule).toEqual({ kind: "interval", intervalMs: 60_000 });
    expect(task.nextRunAt).not.toBeNull();
  });

  it("joins recentRuns and derives isRunning from a running row", async () => {
    registerOwner(engine, "agent", ["taskA"]);
    await store.upsertRun({
      id: "r-done",
      ownerId: "agent",
      taskName: "taskA",
      ownerGeneration: 1,
      status: "success",
      trigger: "scheduled",
      scheduledAt: "2026-07-06T10:00:00.000Z",
      startedAt: "2026-07-06T10:00:01.000Z",
      finishedAt: "2026-07-06T10:00:05.000Z",
      durationMs: 4000,
      error: null,
    });
    await store.upsertRun({
      id: "r-live",
      ownerId: "agent",
      taskName: "taskA",
      ownerGeneration: 1,
      status: "running",
      trigger: "manual",
      scheduledAt: null,
      startedAt: "2026-07-06T11:00:00.000Z",
      finishedAt: null,
      durationMs: null,
      error: null,
    });

    const { tasks } = await fetchTasks();
    const task = tasks.find(t => t.name === "taskA")!;
    expect(task.isRunning).toBe(true);
    // startedAt desc：running（11:00）在前，success（10:00:01）在后。
    expect(task.recentRuns.map(r => r.id)).toEqual(["r-live", "r-done"]);
    expect(task.recentRuns[1]).toMatchObject({
      status: "success",
      trigger: "scheduled",
      durationMs: 4000,
      finishedAt: "2026-07-06T10:00:05.000Z",
    });
  });

  it("does not leak orphan history whose task the owner no longer registers", async () => {
    registerOwner(engine, "agent", ["taskA"]); // 只注册 taskA
    await store.upsertRun({
      id: "orphan",
      ownerId: "agent",
      taskName: "taskGone",
      ownerGeneration: 1,
      status: "success",
      trigger: "scheduled",
      scheduledAt: null,
      startedAt: "2026-07-06T10:00:00.000Z",
      finishedAt: "2026-07-06T10:00:01.000Z",
      durationMs: 1000,
      error: null,
    });

    const { tasks } = await fetchTasks();
    expect(tasks.map(t => t.name)).toEqual(["taskA"]);
  });
});
