import { defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";

/**
 * 统一触发 wire（scheduler B P3，issue #493）。手动触发从「前端直接调 owner 本地」改成
 * 「前端 → scheduler → 反向 callback 回 owner」两跳：
 *
 * 1. **触发入口**（前端 → scheduler，经 gateway）：`triggerTask`。scheduler 收到后查该 owner
 *    自报的 callbackBaseUrl，反向 POST 回它的 triggerCallback 端点，把 owner 的判别联合原样透传
 *    回前端；owner 未注册/连不上则归一为 `owner_unreachable`。
 * 2. **反向回调**（scheduler → owner，owner 实现）：`triggerCallback`。owner 收到 taskName 后
 *    本地跑对应 handler（SDK triggerNow），回 accepted / rejected。owner 侧从不产生
 *    `owner_unreachable`——那是 scheduler 对 callback 失败的归一。
 *
 * 两条路由的判别联合形状**均 HTTP 200**（in-band 判别联合，沿袭 register accepted:false 风格，
 * 不用 4xx），让前端 / scheduler 无需自定义 error-handler 就能读到结构化结果。
 */

/** owner 侧触发结果：accepted（已本地起跑）| rejected（未知任务 / 与在跑任务重叠）。 */
export const SchedulerTriggerCallbackResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("accepted") }).strict(),
  z
    .object({
      outcome: z.literal("rejected"),
      reason: z.enum(["unknown_task", "overlap"]),
    })
    .strict(),
]);

export type SchedulerTriggerCallbackResponse = z.infer<
  typeof SchedulerTriggerCallbackResponseSchema
>;

/**
 * 触发入口响应（前端可见）：在 owner 侧两种结果之外多一种 `owner_unreachable`——owner 未注册 /
 * callback 连不上 / 超时 / 非 2xx / 响应无效时由 scheduler 归一产生。前端据此提示「调度未连」。
 */
export const SchedulerTriggerResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("accepted") }).strict(),
  z
    .object({
      outcome: z.literal("rejected"),
      reason: z.enum(["unknown_task", "overlap"]),
    })
    .strict(),
  z.object({ outcome: z.literal("owner_unreachable") }).strict(),
]);

export type SchedulerTriggerResponse = z.infer<typeof SchedulerTriggerResponseSchema>;

/** 触发入口路径参数：ownerId + taskName（都进路径段）。 */
export const SchedulerTriggerParamsSchema = z
  .object({
    ownerId: z.string().min(1),
    taskName: z.string().min(1),
  })
  .strict();

export type SchedulerTriggerParams = z.infer<typeof SchedulerTriggerParamsSchema>;

/**
 * 触发入口契约（前端 → scheduler，经 gateway）。本 P3 先把路由建好，前端仍走旧路径（P4 才切）。
 * 无请求体（触发意图全在路径参数里），input 建模成空对象（registerJsonRoute 已把 POST 空 body
 * 归一化成 {}）。
 */
export const schedulerTriggerContract = {
  triggerTask: defineJsonRoute({
    method: "POST",
    path: "/scheduler/tasks/:ownerId/:taskName/trigger",
    params: SchedulerTriggerParamsSchema,
    input: z.object({}).strict(),
    output: SchedulerTriggerResponseSchema,
  }),
} as const;

/** 反向回调请求（scheduler → owner）：只带待触发的 taskName。 */
export const SchedulerTriggerCallbackRequestSchema = z
  .object({
    taskName: z.string().min(1),
  })
  .strict();

export type SchedulerTriggerCallbackRequest = z.infer<typeof SchedulerTriggerCallbackRequestSchema>;

/**
 * 反向回调契约（scheduler 消费、owner 实现）。scheduler 每次触发向该 owner 的 callbackBaseUrl 现
 * 构造一个指向它的 client（每 owner 地址不同）；5s 超时、不重试（手动触发要快速失败）。
 */
export const schedulerTriggerCallbackContract = {
  triggerCallback: defineJsonRoute({
    method: "POST",
    path: "/internal/scheduler-trigger",
    input: SchedulerTriggerCallbackRequestSchema,
    output: SchedulerTriggerCallbackResponseSchema,
    // 手动触发要快速失败：callback 5s 无响应即归一为 owner_unreachable，绝不拖长前端等待。
    timeoutMs: 5_000,
  }),
} as const;
