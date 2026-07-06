import { defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";
import { SchedulerReportRunRequestSchema, SchedulerReportRunResponseSchema } from "./run.js";
import { SchedulerMisfirePolicySchema, SchedulerTaskScheduleSchema } from "./schedule.js";

/**
 * kagami-scheduler 进程的对外契约（单一事实源，issue #428）。调度器是通用薄时钟：使用方经 SDK
 * 注册"名字 + 周期 + 补偿策略"，调度器到点通过 SSE（见 event.ts，非 JSON 路由）推一个 tick 回去，
 * 业务逻辑全在使用方。这里只有两条 JSON 路由：注册（幂等 replace-all）与状态查询（tick 侧）。
 *
 * overlap / dedupe / handler 都是使用方 SDK 的本地态，不进 wire——调度器只需 schedule + misfire。
 */

/** 注册时一个任务的 wire 定义（只含调度器需要的：名字 / 周期 / 补偿策略）。 */
export const SchedulerTaskManifestSchema = z
  .object({
    name: z.string().min(1),
    schedule: SchedulerTaskScheduleSchema,
    misfire: SchedulerMisfirePolicySchema,
    /** 仅 misfire=catchup 时有意义：重连最多补几次。缺省视作 1。 */
    maxCatchup: z.number().int().positive().optional(),
  })
  .strict();

export type SchedulerTaskManifest = z.infer<typeof SchedulerTaskManifestSchema>;

/**
 * 注册请求：使用方每次（重）连提交**完整**期望任务集，调度器按 ownerId 做 replace-all。
 * - `ownerId`：使用方稳定标识（agent = "agent"）。
 * - `clientInstanceId`：本次进程启动的随机 UUID，标识化身。
 * - `generation`：进程启动时刻毫秒时间戳，天然单调；调度器只保留见过的最大 generation。
 * - `callbackBaseUrl`：owner 自描述的反向回调根地址（如 `http://127.0.0.1:20003`）。统一触发
 *   （#493 P3）里，前端 → scheduler 的手动触发经此地址反向 POST 回 owner 的 triggerCallback 端点，
 *   由 owner 本地跑 handler。owner 每次（重）连自报，replace-all 时更新（进程可能换端口/重启）。
 */
export const SchedulerRegisterRequestSchema = z
  .object({
    ownerId: z.string().min(1),
    clientInstanceId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    // url()：scheduler 会据此现构造 client 反向 POST，做个基本格式护栏（拒非 URL 垃圾）。owner 是
    // 本机可信服务、scheduler 绑 127.0.0.1 只本机可 register，故不做更严的 host allowlist。
    callbackBaseUrl: z.string().url(),
    tasks: z.array(SchedulerTaskManifestSchema),
  })
  .strict();

export type SchedulerRegisterRequest = z.infer<typeof SchedulerRegisterRequestSchema>;

/**
 * 注册响应。stale（generation 落后于在册值）用 in-band `accepted:false` 回（HTTP 200，判别联合），
 * 而非 409——契约原生、免自定义 error-handler；SDK 收到 accepted:false 视作"已有更新化身"，不重试。
 */
export const SchedulerRegisterResponseSchema = z.discriminatedUnion("accepted", [
  z
    .object({
      accepted: z.literal(true),
      generation: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      accepted: z.literal(false),
      reason: z.literal("stale_generation"),
      current: z.number().int().nonnegative(),
    })
    .strict(),
]);

export type SchedulerRegisterResponse = z.infer<typeof SchedulerRegisterResponseSchema>;

/** status 请求：按 ownerId 查该使用方在册任务的 tick 侧状态。 */
export const SchedulerStatusRequestSchema = z
  .object({
    ownerId: z.string().min(1),
  })
  .strict();

export type SchedulerStatusRequest = z.infer<typeof SchedulerStatusRequestSchema>;

/** 一个任务的 tick 侧状态（调度器拥有的部分）。 */
export const SchedulerTickStatusSchema = z
  .object({
    name: z.string().min(1),
    schedule: SchedulerTaskScheduleSchema,
    /** 下次触发时刻（driver 计算）；未排期为 null。 */
    nextRunAt: z.string().datetime().nullable(),
    /** 上次触发（发/存 pending）的 scheduledAt；从未触发为 null。 */
    lastScheduledAt: z.string().datetime().nullable(),
    /** 上次实际发出（投递到活连接）的时刻；从未发出为 null。 */
    lastEmittedAt: z.string().datetime().nullable(),
  })
  .strict();

export type SchedulerTickStatus = z.infer<typeof SchedulerTickStatusSchema>;

export const SchedulerStatusResponseSchema = z
  .object({
    tasks: z.array(SchedulerTickStatusSchema),
  })
  .strict();

export type SchedulerStatusResponse = z.infer<typeof SchedulerStatusResponseSchema>;

export const schedulerApiContract = {
  register: defineJsonRoute({
    method: "POST",
    path: "/scheduler/register",
    input: SchedulerRegisterRequestSchema,
    output: SchedulerRegisterResponseSchema,
  }),
  status: defineJsonRoute({
    method: "POST",
    path: "/scheduler/status",
    input: SchedulerStatusRequestSchema,
    output: SchedulerStatusResponseSchema,
  }),
  // run 上报（issue #493 P1）：使用方 SDK 上报一次执行历史，按 runId 幂等 upsert。
  reportRun: defineJsonRoute({
    method: "POST",
    path: "/scheduler/runs",
    input: SchedulerReportRunRequestSchema,
    output: SchedulerReportRunResponseSchema,
  }),
} as const;
