import { z } from "zod";

/**
 * 调度器 → 使用方的**入站 tick** wire（SSE 载荷，issue #428）。
 *
 * 与 napcat 的入站事件不同：napcat 事件是**外部事实**、断连必须逐条回放（outbox + seq +
 * Last-Event-ID）。tick 是**派生事实**——"到点了"是算出来的，断连 2 小时不该补 120 次。因此本流
 * 故意**不做持久回放**：调度器只在内存按 misfire 策略缓存 pending tick，(重)连时冲一次；**无 seq、
 * 无 Last-Event-ID、无 outbox 表**。诚实的投递保证是"live 尽力而为 + 短断连按策略补 + 调度器重启
 * 期间 pending 丢失"，不是严格 at-least-once。
 */
export const SchedulerTickEventSchema = z
  .object({
    taskName: z.string().min(1),
    /** `${taskName}@${scheduledAt}`——使用方侧 occurrence 去重键（仅 dedupe 任务用）。 */
    occurrenceId: z.string().min(1),
    /** 本次 occurrence 应触发的时刻（ISO）。 */
    scheduledAt: z.string().datetime(),
    /** 调度器实际发出的时刻（ISO）；补发（catch-up）时晚于 scheduledAt。 */
    emittedAt: z.string().datetime(),
    /** 是否人工触发。SSE 只传自动 tick（manual 触发在使用方本地跑，不走 SSE），恒为 false。 */
    manual: z.literal(false),
  })
  .strict();

export type SchedulerTickEvent = z.infer<typeof SchedulerTickEventSchema>;

/**
 * SSE tick 流路径（使用方拨出订阅；非 JsonRoute，是 `text/event-stream` 长流）。ownerId 走 query
 * 参数：`GET /scheduler/ticks?ownerId=<id>`，调度器只把该 owner 名下任务的 tick 推给该连接。
 */
export const SCHEDULER_TICKS_SSE_PATH = "/scheduler/ticks";

/** SSE 心跳：调度器每 15s 发一个注释帧保活；使用方侧超阈值无帧即判半开重连（复刻 napcat）。 */
export const SCHEDULER_SSE_HEARTBEAT_MS = 15_000;
