import { defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";
import { SchedulerRunStatusSchema, SchedulerRunTriggerSchema } from "./run.js";
import { SchedulerTaskScheduleSchema } from "./schedule.js";

/**
 * 全局任务观测视图 wire（scheduler B P4，issue #493）。前端第一次真正切到 scheduler：不再经 agent
 * 的 listSchedulerTasks 中转，而是直接查 scheduler 的这条全局端点（跨全部 owner）。
 *
 * 数据来源是「活任务（engine 内存）左连接执行历史（TaskRun 库）」：
 * - 活任务侧（ownerId / name / schedule / nextRunAt）来自 engine 内存 owners map，跨全部 owner。
 * - 历史侧（recentRuns / isRunning）来自 DB，每 (ownerId, taskName) 取最近 RECENT_RUNS_PER_TASK 条。
 * - 以活任务为主做左连接：无历史的活任务 recentRuns 为空、isRunning=false（历史只增不减，孤儿历史
 *   行——owner 已删该任务——不进视图）。
 */

/** 每任务回传的最近执行历史条数上限（startedAt desc）。 */
export const RECENT_RUNS_PER_TASK = 10;

/** 一条执行历史（P1 的 TaskRun 落库形状投影到 wire；时间字段走 ISO 字符串）。 */
export const SchedulerTaskViewRunSchema = z
  .object({
    id: z.string().min(1),
    status: SchedulerRunStatusSchema,
    trigger: SchedulerRunTriggerSchema,
    scheduledAt: z.string().datetime().nullable(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    error: z.string().nullable(),
  })
  .strict();

export type SchedulerTaskViewRun = z.infer<typeof SchedulerTaskViewRunSchema>;

/** 一个活任务的完整观测视图（tick 侧活状态 + DB 侧执行历史）。 */
export const SchedulerTaskViewSchema = z
  .object({
    ownerId: z.string().min(1),
    name: z.string().min(1),
    schedule: SchedulerTaskScheduleSchema,
    /** 下次触发时刻（driver 算）；未排期为 null。 */
    nextRunAt: z.string().datetime().nullable(),
    /** 派生：该 (ownerId, taskName) 存在 status=running 的 TaskRun 行。 */
    isRunning: z.boolean(),
    /** 最近 RECENT_RUNS_PER_TASK 条执行历史，startedAt desc。 */
    recentRuns: z.array(SchedulerTaskViewRunSchema),
  })
  .strict();

export type SchedulerTaskView = z.infer<typeof SchedulerTaskViewSchema>;

export const SchedulerTasksViewResponseSchema = z
  .object({
    tasks: z.array(SchedulerTaskViewSchema),
  })
  .strict();

export type SchedulerTasksViewResponse = z.infer<typeof SchedulerTasksViewResponseSchema>;

/**
 * 全局任务查询契约（前端 → scheduler，经 gateway `/api/scheduler/tasks`）。无 params、无请求体
 * （registerJsonRoute 已把 GET/POST 空 body 归一化成 {}）。
 *
 * 与 trigger 的 `POST /scheduler/tasks/:ownerId/:taskName/trigger` 同前缀但不冲突：方法（GET vs POST）
 * + 路径深度（/scheduler/tasks vs /scheduler/tasks/:o/:t/trigger）都不同，fastify 能区分。
 */
export const schedulerTasksViewContract = {
  listTasks: defineJsonRoute({
    method: "GET",
    path: "/scheduler/tasks",
    input: z.object({}).strict(),
    output: SchedulerTasksViewResponseSchema,
  }),
} as const;
