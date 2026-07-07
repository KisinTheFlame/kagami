import { z } from "zod";

/**
 * kagami-scheduler 的通用调度原语 wire（issue #428）。这些 schema 不含任何具体业务语义——
 * 调度器只认识"一个按 cron/interval 触发、叫某个名字、带某种补偿策略的任务"。具体任务（ithome /
 * todo / data-retention）由使用方（agent）在代码里写死并注册，调度器永不认识它们的含义。
 */

/** 一个任务的触发周期：cron 表达式或固定 interval（可带首次延迟）。 */
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

/**
 * 断连 / 漏触发时的补偿策略（调度器侧语义）：
 * - `drop`：漏了就漏了，不补，下次照常。
 * - `latest`：断连期间无论触发多少次，重连时只补最新一次（合并）。
 * - `catchup`：重连时补最近 `maxCatchup` 次（cron 多次命中按时间倒序截取最新的几个）。
 *
 * 注意：这与"使用方本地的执行并发策略（overlap）"是两回事——overlap 归 SDK，不进 wire。
 */
export const SchedulerMisfirePolicySchema = z.enum(["drop", "latest", "catchup"]);

export type SchedulerMisfirePolicy = z.infer<typeof SchedulerMisfirePolicySchema>;
