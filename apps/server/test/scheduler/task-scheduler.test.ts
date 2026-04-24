import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TaskScheduler } from "../../src/scheduler/application/task-scheduler.js";
import type { ScheduledTask } from "../../src/scheduler/domain/scheduled-task.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

beforeAll(() => {
  initTestLoggerRuntime();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeIntervalTask(name: string, run: ScheduledTask["run"]): ScheduledTask {
  return {
    name,
    schedule: { kind: "interval", intervalMs: 100, initialDelayMs: 0 },
    run,
  };
}

describe("TaskScheduler", () => {
  it("rejects duplicate task names", () => {
    const scheduler = new TaskScheduler();
    const a = makeIntervalTask("a", async () => {});
    scheduler.register(a);
    expect(() => scheduler.register({ ...a, run: async () => {} })).toThrow(
      /duplicate scheduled task name/,
    );
  });

  it("rejects register after start", () => {
    const scheduler = new TaskScheduler();
    scheduler.start();
    try {
      expect(() => scheduler.register(makeIntervalTask("a", async () => {}))).toThrow(
        /cannot register task/,
      );
    } finally {
      void scheduler.stop();
    }
  });

  it("rejects invalid cron expressions at register time", () => {
    const scheduler = new TaskScheduler();
    const invalid: ScheduledTask = {
      name: "bad",
      schedule: { kind: "cron", expression: "not a cron" },
      run: async () => {},
    };
    expect(() => scheduler.register(invalid)).toThrow();
  });

  it("triggerNow runs the task and records success in run history", async () => {
    const scheduler = new TaskScheduler();
    const run = vi.fn(async () => ({ did: "work" }));
    scheduler.register(makeIntervalTask("a", run));

    const result = await scheduler.triggerNow("a");
    expect(result).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);

    const status = scheduler.listStatus();
    expect(status).toHaveLength(1);
    expect(status[0]?.recentRuns).toHaveLength(1);
    expect(status[0]?.recentRuns[0]?.status).toBe("success");
    expect(status[0]?.recentRuns[0]?.metadata).toEqual({ did: "work" });
  });

  it("triggerNow returns overlap when the task is still running without polluting history", async () => {
    const scheduler = new TaskScheduler();
    let resolveRun!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveRun = resolve;
        }),
    );
    scheduler.register(makeIntervalTask("a", run));

    const firstPromise = scheduler.triggerNow("a");
    // Yield so fireOnce sets runningRun before we trigger again.
    await Promise.resolve();
    await Promise.resolve();

    const second = await scheduler.triggerNow("a");
    expect(second).toEqual({ ok: false, reason: "overlap" });

    resolveRun();
    await firstPromise;

    const history = scheduler.listStatus()[0]?.recentRuns ?? [];
    // triggerNow is a human-driven debugging entry point; its overlap rejection
    // returns a response to the caller instead of writing a history entry.
    expect(history.filter(r => r.status === "skipped_overlap")).toHaveLength(0);
    expect(history.at(-1)?.status).toBe("success");
  });

  it("records error status when run throws", async () => {
    const scheduler = new TaskScheduler();
    scheduler.register(
      makeIntervalTask("a", async () => {
        throw new Error("boom");
      }),
    );

    await scheduler.triggerNow("a");

    const status = scheduler.listStatus()[0];
    expect(status?.recentRuns.at(-1)?.status).toBe("error");
    expect(status?.recentRuns.at(-1)?.errorMessage).toBe("boom");
  });

  it("triggerNow throws for unknown task names", async () => {
    const scheduler = new TaskScheduler();
    await expect(scheduler.triggerNow("missing")).rejects.toThrow(/unknown scheduled task/);
  });

  it("stop aborts in-flight runs via signal", async () => {
    const scheduler = new TaskScheduler();
    const captured: { signal: AbortSignal | null } = { signal: null };
    scheduler.register(
      makeIntervalTask("a", async signal => {
        captured.signal = signal;
        await new Promise<void>(resolve => {
          signal.addEventListener("abort", () => resolve());
        });
      }),
    );

    scheduler.start();
    const triggered = scheduler.triggerNow("a");
    await Promise.resolve();
    await Promise.resolve();

    const stopPromise = scheduler.stop();
    await stopPromise;
    await triggered;

    expect(captured.signal).not.toBeNull();
    expect(captured.signal?.aborted).toBe(true);
  });
});
