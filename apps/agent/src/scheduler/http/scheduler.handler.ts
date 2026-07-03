import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { agentApiContract } from "@kagami/agent-api/contract";
import { type SchedulerTaskRun, type SchedulerTaskStatus } from "@kagami/agent-api/scheduler";
import type { TaskRun, TaskStatus } from "../domain/scheduled-task.js";
import type { TaskScheduler } from "../application/task-scheduler.js";

type SchedulerHandlerDeps = {
  taskScheduler: TaskScheduler;
};

/**
 * 调度任务查询/触发路由。路由与 schema 的单一事实源在 @kagami/agent-api（#279 PR5）；
 * 此前是裸 app.get/post + 手动 parse，收进契约注册（行为不变，响应仍经 output schema 校验）。
 */
export class SchedulerHandler {
  private readonly taskScheduler: TaskScheduler;

  public constructor({ taskScheduler }: SchedulerHandlerDeps) {
    this.taskScheduler = taskScheduler;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, agentApiContract.listSchedulerTasks, () => {
      return { tasks: this.taskScheduler.listStatus().map(toSchemaStatus) };
    });

    registerJsonRoute(app, agentApiContract.triggerSchedulerTask, ({ params }) => {
      return this.taskScheduler.triggerNow(params.name);
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
