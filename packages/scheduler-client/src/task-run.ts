import type { SchedulerTaskRun } from "@kagami/scheduler-api/schedule";

/**
 * 使用方本地的一条执行记录。真正跑 handler 的是使用方（agent），只有它知道成功/失败/耗时——
 * 这份历史归 SDK，调度器只拥有 tick 侧（scheduledAt / emittedAt / nextRunAt）。整块从原
 * apps/agent 进程内 TaskScheduler 的执行记录搬迁而来（issue #428）。
 */
export type TaskRunStatus = "running" | "success" | "error" | "skipped_overlap";

export type TaskRunMetadata = Record<string, unknown>;

export type TaskRun = {
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  status: TaskRunStatus;
  errorMessage?: string;
  metadata?: TaskRunMetadata;
};

/** 定长执行历史环形缓冲（超容量丢最旧）。 */
export class TaskRunHistory {
  private readonly capacity: number;
  private readonly buffer: TaskRun[] = [];

  public constructor({ capacity }: { capacity: number }) {
    if (capacity <= 0) {
      throw new Error(`TaskRunHistory capacity must be positive, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  public push(run: TaskRun): void {
    this.buffer.push(run);
    while (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  public toArray(): TaskRun[] {
    return [...this.buffer];
  }
}

/** 本地 TaskRun → wire 的 SchedulerTaskRun（Date → ISO）。 */
export function toWireRun(run: TaskRun): SchedulerTaskRun {
  const wire: SchedulerTaskRun = {
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    durationMs: run.durationMs,
    status: run.status,
  };
  if (run.errorMessage !== undefined) {
    wire.errorMessage = run.errorMessage;
  }
  if (run.metadata !== undefined) {
    wire.metadata = run.metadata;
  }
  return wire;
}
