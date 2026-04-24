import Fastify from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TaskScheduler } from "../../src/scheduler/application/task-scheduler.js";
import { SchedulerHandler } from "../../src/scheduler/http/scheduler.handler.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

beforeAll(() => {
  initTestLoggerRuntime();
});

describe("SchedulerHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /scheduler/tasks returns registered tasks with their run history", async () => {
    const taskScheduler = new TaskScheduler();
    taskScheduler.register({
      name: "sample",
      schedule: { kind: "interval", intervalMs: 1_000 },
      run: async () => ({ did: "x" }),
    });
    await taskScheduler.triggerNow("sample");

    new SchedulerHandler({ taskScheduler }).register(app);

    const response = await app.inject({
      method: "GET",
      url: "/scheduler/tasks",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      tasks: Array<{ name: string; recentRuns: Array<{ status: string }> }>;
    };
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]?.name).toBe("sample");
    expect(body.tasks[0]?.recentRuns.at(-1)?.status).toBe("success");
  });

  it("POST /scheduler/tasks/:name/trigger runs the task", async () => {
    const taskScheduler = new TaskScheduler();
    let invocations = 0;
    taskScheduler.register({
      name: "sample",
      schedule: { kind: "interval", intervalMs: 1_000 },
      run: async () => {
        invocations += 1;
      },
    });

    new SchedulerHandler({ taskScheduler }).register(app);

    const response = await app.inject({
      method: "POST",
      url: "/scheduler/tasks/sample/trigger",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(invocations).toBe(1);
  });

  it("POST trigger returns overlap when task is busy", async () => {
    const taskScheduler = new TaskScheduler();
    let resolveRun!: () => void;
    taskScheduler.register({
      name: "sample",
      schedule: { kind: "interval", intervalMs: 1_000 },
      run: () =>
        new Promise<void>(resolve => {
          resolveRun = resolve;
        }),
    });

    new SchedulerHandler({ taskScheduler }).register(app);

    const first = app.inject({
      method: "POST",
      url: "/scheduler/tasks/sample/trigger",
    });
    // Let the first invocation settle into runningRun = true.
    await new Promise(resolve => setImmediate(resolve));

    const second = await app.inject({
      method: "POST",
      url: "/scheduler/tasks/sample/trigger",
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: false, reason: "overlap" });

    resolveRun();
    await first;
  });
});
