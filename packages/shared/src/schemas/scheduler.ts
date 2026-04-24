import { z } from "zod";

export const SchedulerTaskScheduleSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("cron"),
      expression: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("interval"),
      intervalMs: z.number().int().positive(),
      initialDelayMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);

export type SchedulerTaskSchedule = z.infer<typeof SchedulerTaskScheduleSchema>;

export const SchedulerTaskRunStatusSchema = z.enum([
  "running",
  "success",
  "error",
  "skipped_overlap",
]);

export type SchedulerTaskRunStatus = z.infer<typeof SchedulerTaskRunStatusSchema>;

export const SchedulerTaskRunSchema = z
  .object({
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    status: SchedulerTaskRunStatusSchema,
    errorMessage: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type SchedulerTaskRun = z.infer<typeof SchedulerTaskRunSchema>;

export const SchedulerTaskStatusSchema = z
  .object({
    name: z.string().min(1),
    schedule: SchedulerTaskScheduleSchema,
    nextRunAt: z.string().datetime().nullable(),
    isRunning: z.boolean(),
    recentRuns: z.array(SchedulerTaskRunSchema),
  })
  .strict();

export type SchedulerTaskStatus = z.infer<typeof SchedulerTaskStatusSchema>;

export const SchedulerTaskListResponseSchema = z
  .object({
    tasks: z.array(SchedulerTaskStatusSchema),
  })
  .strict();

export type SchedulerTaskListResponse = z.infer<typeof SchedulerTaskListResponseSchema>;

export const SchedulerTriggerParamsSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();

export type SchedulerTriggerParams = z.infer<typeof SchedulerTriggerParamsSchema>;

export const SchedulerTriggerResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: z.literal("overlap"),
    })
    .strict(),
]);

export type SchedulerTriggerResponse = z.infer<typeof SchedulerTriggerResponseSchema>;
