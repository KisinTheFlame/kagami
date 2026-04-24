export type ScheduleSpec =
  | { kind: "cron"; expression: string }
  | { kind: "interval"; intervalMs: number; initialDelayMs?: number };

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

export type TaskStatus = {
  name: string;
  schedule: ScheduleSpec;
  nextRunAt: Date | null;
  isRunning: boolean;
  recentRuns: TaskRun[];
};

export interface ScheduledTask {
  readonly name: string;
  readonly schedule: ScheduleSpec;
  run(signal: AbortSignal): Promise<TaskRunMetadata | void>;
}
