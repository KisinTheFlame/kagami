import { AppLogger } from "@kagami/kernel/logger/logger";
import { serializeError } from "@kagami/kernel/logger/serializer";
import type { ScheduleSpec, ScheduledTask, TaskRun, TaskStatus } from "../domain/scheduled-task.js";
import { TaskRunHistory } from "../domain/task-run-history.js";
import { CronDriver } from "../infra/cron-driver.js";
import { IntervalDriver } from "../infra/interval-driver.js";

const DEFAULT_TASK_HISTORY_SIZE = 10;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

const logger = new AppLogger({ source: "scheduler.task-scheduler" });

type Driver = CronDriver | IntervalDriver;

type RegistryEntry = {
  task: ScheduledTask;
  driver: Driver;
  history: TaskRunHistory;
  runningRun: TaskRun | null;
  abortController: AbortController | null;
};

export type TriggerNowResult = { ok: true } | { ok: false; reason: "overlap" };

export class TaskScheduler {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly historySize: number;
  private readonly shutdownTimeoutMs: number;
  private started = false;

  public constructor(
    options: {
      historySize?: number;
      shutdownTimeoutMs?: number;
    } = {},
  ) {
    this.historySize = options.historySize ?? DEFAULT_TASK_HISTORY_SIZE;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  public register(task: ScheduledTask): void {
    if (this.started) {
      throw new Error(`cannot register task "${task.name}" after scheduler has started`);
    }
    if (this.entries.has(task.name)) {
      throw new Error(`duplicate scheduled task name: ${task.name}`);
    }

    const onFire = (): void => {
      void this.fireOnce(task.name);
    };

    const driver = this.createDriver(task.schedule, onFire);
    this.entries.set(task.name, {
      task,
      driver,
      history: new TaskRunHistory({ capacity: this.historySize }),
      runningRun: null,
      abortController: null,
    });
  }

  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    for (const entry of this.entries.values()) {
      entry.driver.start();
    }
    logger.info("Task scheduler started", {
      event: "scheduler.started",
      taskCount: this.entries.size,
      taskNames: [...this.entries.keys()],
    });
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;

    for (const entry of this.entries.values()) {
      entry.driver.stop();
    }

    const running = [...this.entries.values()].filter(entry => entry.runningRun !== null);
    if (running.length === 0) {
      logger.info("Task scheduler stopped", {
        event: "scheduler.stopped",
        runningAtStop: 0,
      });
      return;
    }

    for (const entry of running) {
      entry.abortController?.abort();
    }

    const waitForAll = Promise.allSettled(running.map(entry => this.waitForIdle(entry.task.name)));
    const timeoutPromise = new Promise<"timeout">(resolve => {
      const timer = setTimeout(() => resolve("timeout"), this.shutdownTimeoutMs);
      timer.unref?.();
    });

    const result = await Promise.race([waitForAll.then(() => "done" as const), timeoutPromise]);

    if (result === "timeout") {
      logger.warn("Task scheduler shutdown timed out; some tasks may still be running", {
        event: "scheduler.stopped.timeout",
        timeoutMs: this.shutdownTimeoutMs,
        stillRunning: running
          .filter(entry => entry.runningRun !== null)
          .map(entry => entry.task.name),
      });
    } else {
      logger.info("Task scheduler stopped", {
        event: "scheduler.stopped",
        runningAtStop: running.length,
      });
    }
  }

  public listStatus(): TaskStatus[] {
    return [...this.entries.values()].map(entry => ({
      name: entry.task.name,
      schedule: entry.task.schedule,
      nextRunAt: entry.driver.peekNextRun(),
      isRunning: entry.runningRun !== null,
      recentRuns: entry.history.toArray(),
    }));
  }

  public async triggerNow(name: string): Promise<TriggerNowResult> {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`unknown scheduled task: ${name}`);
    }
    if (entry.runningRun) {
      return { ok: false, reason: "overlap" };
    }
    await this.fireOnce(name);
    return { ok: true };
  }

  private createDriver(schedule: ScheduleSpec, onFire: () => void): Driver {
    if (schedule.kind === "cron") {
      return new CronDriver({ expression: schedule.expression, handler: onFire });
    }
    return new IntervalDriver({
      intervalMs: schedule.intervalMs,
      initialDelayMs: schedule.initialDelayMs ?? 0,
      handler: onFire,
    });
  }

  private async fireOnce(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) {
      return;
    }
    const now = new Date();

    if (entry.runningRun) {
      entry.history.push({
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        status: "skipped_overlap",
      });
      return;
    }

    const abortController = new AbortController();
    const run: TaskRun = {
      startedAt: now,
      finishedAt: null,
      durationMs: null,
      status: "running",
    };
    entry.runningRun = run;
    entry.abortController = abortController;
    const startedAtMs = Date.now();

    try {
      const metadata = await entry.task.run(abortController.signal);
      run.status = "success";
      if (metadata) {
        run.metadata = metadata;
      }
    } catch (error) {
      run.status = "error";
      run.errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("Scheduled task run failed", {
        event: "scheduler.task.run_failed",
        taskName: name,
        error: serializeError(error),
      });
    } finally {
      const finishedAt = new Date();
      run.finishedAt = finishedAt;
      run.durationMs = Date.now() - startedAtMs;
      entry.runningRun = null;
      entry.abortController = null;
      entry.history.push(run);
    }
  }

  private async waitForIdle(name: string, pollIntervalMs = 50): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) {
      return;
    }
    while (entry.runningRun !== null) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, pollIntervalMs);
        timer.unref?.();
      });
    }
  }
}
