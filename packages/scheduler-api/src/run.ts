import { z } from "zod";

/**
 * run 上报 wire（scheduler B P1，issue #493）。使用方 SDK 每跑一次任务，向 scheduler 上报一条
 * 执行历史。P1 只把服务端存储 + 上报端点建好（存储层先 de-risk）；SDK 侧真正的两阶段回报（先报
 * running、跑完再报终态）是后续 P2。上报按 `id`（runId）幂等 upsert——同一 id 后到覆盖先到，
 * 允许「running → 终态」两次上报同 id 只留一行。
 *
 * ownerId / taskName 反范式化为裸字符串：scheduler 库无 tasks 表，任务定义仍由使用方代码写死。
 */

/** 一次执行的状态：running（在跑）| success | failure | interrupted（进程崩溃/被打断，未收到终态）。 */
export const SchedulerRunStatusSchema = z.enum(["running", "success", "failure", "interrupted"]);

export type SchedulerRunStatus = z.infer<typeof SchedulerRunStatusSchema>;

/** 触发来源：scheduled（到点自动）| manual（人工触发）。 */
export const SchedulerRunTriggerSchema = z.enum(["scheduled", "manual"]);

export type SchedulerRunTrigger = z.infer<typeof SchedulerRunTriggerSchema>;

/**
 * 一次 run 上报请求。时间字段走 ISO 字符串（wire 无 Date）；ownerGeneration 是使用方进程启动时刻的
 * 单调毫秒时间戳（number，落库转 BigInt）。running 时 finishedAt / durationMs 为 null，终态填齐。
 */
export const SchedulerReportRunRequestSchema = z
  .object({
    /** 一次 run 的稳定唯一标识（runId）；幂等 upsert 键。 */
    id: z.string().min(1),
    ownerId: z.string().min(1),
    taskName: z.string().min(1),
    // generation 是使用方进程启动时刻的毫秒时间戳（Date.now()，~1.7e12）。落库转 BigInt 前，
    // 用 safe-integer 上限兜底：若将来有人误传 ns / snowflake / DB sequence 等超 2^53 的值，
    // JSON 解析已丢精度，这里直接 400 拒收，而不是静默持久化被截断的错误 generation。
    ownerGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    status: SchedulerRunStatusSchema,
    trigger: SchedulerRunTriggerSchema,
    scheduledAt: z.string().datetime().nullable().optional(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable().optional(),
    durationMs: z.number().int().nonnegative().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .strict();

export type SchedulerReportRunRequest = z.infer<typeof SchedulerReportRunRequestSchema>;

/** 上报响应：简单 ack。 */
export const SchedulerReportRunResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();

export type SchedulerReportRunResponse = z.infer<typeof SchedulerReportRunResponseSchema>;
