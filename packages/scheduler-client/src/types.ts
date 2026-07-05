import type { SchedulerMisfirePolicy, SchedulerTaskSchedule } from "@kagami/scheduler-api/schedule";
import type { TaskRunMetadata } from "./task-run.js";

/**
 * 派发给 handler 的 tick。是 wire `SchedulerTickEvent` 的超集：`manual` 放宽成 boolean——SSE 到达的
 * tick 恒为 false，`triggerNow` 本地构造的 tick 为 true（人工触发不走 SSE，见 SchedulerClient）。
 */
export type SchedulerTick = {
  taskName: string;
  occurrenceId: string;
  scheduledAt: string;
  emittedAt: string;
  manual: boolean;
};

/** 使用方注册的一个任务的 handler：跑真正的业务；返回可选 metadata 进执行历史。signal 用于优雅关停。 */
export type SchedulerTaskHandler = (
  signal: AbortSignal,
  tick: SchedulerTick,
) => Promise<TaskRunMetadata | void>;

/**
 * 使用方本地的完整任务注册（甲：定义在使用方）。只有 `name + schedule + misfire + maxCatchup`
 * 会经 SDK 上线给调度器；`overlap / dedupe / handler` 是 SDK 本地态，调度器永不认识。
 */
export type SchedulerTaskRegistration = {
  name: string;
  schedule: SchedulerTaskSchedule;
  /** 调度器侧补偿策略（断连补发）。 */
  misfire: SchedulerMisfirePolicy;
  /** 仅 misfire=catchup 有意义。 */
  maxCatchup?: number;
  /** SDK 本地并发策略：skip=运行中丢弃并记 skipped_overlap；queue=当前跑完再补跑最新一次。 */
  overlap: "skip" | "queue";
  /** 开启 occurrence 去重（防同一 occurrence 因重连补发/重叠被处理两次）。需注入 OccurrenceStore。 */
  dedupe?: boolean;
  handler: SchedulerTaskHandler;
};

/**
 * occurrence 去重的持久化端口（使用方实现，如 agent 用 app_state 表）。按任务名存"已处理到的
 * scheduledAt"单值；去重判据：incoming scheduledAt <= 已存则跳过（scheduledAt 单调，存单值即可）。
 */
export interface OccurrenceStore {
  loadLastProcessed(taskName: string): Promise<string | null>;
  saveLastProcessed(taskName: string, scheduledAtIso: string): Promise<void>;
}

export type TriggerNowResult = { ok: true } | { ok: false; reason: "overlap" | "unknown_task" };
