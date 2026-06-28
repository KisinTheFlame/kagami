import type { FastifyInstance } from "fastify";
import {
  SchedulerTaskListResponseSchema,
  SchedulerTriggerResponseSchema,
  type SchedulerTaskRun,
  type SchedulerTaskStatus,
} from "@kagami/shared/schemas/scheduler";
import type { TaskRun, TaskStatus } from "../domain/scheduled-task.js";
import type { TaskScheduler } from "../application/task-scheduler.js";

type SchedulerHandlerDeps = {
  taskScheduler: TaskScheduler;
};

export class SchedulerHandler {
  public readonly prefix = "/scheduler";
  private readonly taskScheduler: TaskScheduler;

  public constructor({ taskScheduler }: SchedulerHandlerDeps) {
    this.taskScheduler = taskScheduler;
  }

  public register(app: FastifyInstance): void {
    app.get(`${this.prefix}/tasks`, async () => {
      const tasks = this.taskScheduler.listStatus().map(toSchemaStatus);
      return SchedulerTaskListResponseSchema.parse({ tasks });
    });

    app.post<{ Params: { name: string } }>(`${this.prefix}/tasks/:name/trigger`, async request => {
      const result = await this.taskScheduler.triggerNow(request.params.name);
      return SchedulerTriggerResponseSchema.parse(result);
    });
  }
}

function toSchemaStatus(status: TaskStatus): SchedulerTaskStatus {
  return {
    name: status.name,
    schedule: status.schedule,
    nextRunAt: status.nextRunAt ? status.nextRunAt.toISOString() : null,
    isRunning: status.isRunning,
    recentRuns: status.recentRuns.map(toSchemaRun),
  };
}

function toSchemaRun(run: TaskRun): SchedulerTaskRun {
  const base: SchedulerTaskRun = {
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    durationMs: run.durationMs,
    status: run.status,
  };
  if (run.errorMessage !== undefined) {
    base.errorMessage = run.errorMessage;
  }
  if (run.metadata !== undefined) {
    base.metadata = run.metadata;
  }
  return base;
}
