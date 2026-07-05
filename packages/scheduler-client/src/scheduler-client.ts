import { randomUUID } from "node:crypto";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { schedulerApiContract, type SchedulerTaskManifest } from "@kagami/scheduler-api/contract";
import { SchedulerTickEventSchema, SCHEDULER_TICKS_SSE_PATH } from "@kagami/scheduler-api/event";
import type { SchedulerTaskStatus } from "@kagami/scheduler-api/schedule";
import { TaskRunHistory, toWireRun, type TaskRun } from "./task-run.js";
import type {
  OccurrenceStore,
  SchedulerTaskRegistration,
  SchedulerTick,
  TriggerNowResult,
} from "./types.js";

const logger = new AppLogger({ source: "scheduler-client" });

const SCHEDULER_UNREACHABLE_MESSAGE = "调度器服务调用失败";
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
// 30s 内无任何帧（含 15s 心跳）判半开：主动 abort 重连。留 2 个心跳周期裕量（复刻 napcat）。
const DEAD_CONNECTION_TIMEOUT_MS = 30_000;
const DEFAULT_HISTORY_SIZE = 10;

type FetchLike = typeof fetch;

type RegistryEntry = {
  reg: SchedulerTaskRegistration;
  history: TaskRunHistory;
  running: boolean;
  abortController: AbortController | null;
  /** overlap=queue 时暂存的最新待补 tick（只留一个，天然合并）。 */
  queuedTick: SchedulerTick | null;
};

type SchedulerClientDeps = {
  /** 调度器基址，如 `http://127.0.0.1:20014`。 */
  baseUrl: string;
  /** 使用方稳定标识（agent = "agent"）。 */
  ownerId: string;
  /** occurrence 去重持久化（仅当有 dedupe 任务时需要）。 */
  occurrenceStore?: OccurrenceStore;
  historySize?: number;
  fetch?: FetchLike;
};

/**
 * kagami-scheduler 的使用方 SDK（issue #428）：把"名字 + 周期 + 补偿策略"注册给独立调度器进程，
 * 长连它的 SSE tick 流，收到 tick 自动派发到本地 handler。业务逻辑全在使用方——本 SDK 只负责
 * 注册、订阅、本地并发（mutex/queue）、occurrence 去重、执行历史。
 *
 * 注册即写死（甲）：任务集硬编码在使用方代码，每次（重）连重新声明同一份，无 DB、无动态增删。
 * 连接生命周期：注册（POST replace-all）→ 打开 SSE → 掉线指数退避 + 半开检测重连（重连重新注册）。
 * tick 是派生事实：调度器不做持久回放，断连按 misfire 策略合并/补发，本 SDK 只管收到即派发。
 */
export class SchedulerClient {
  private readonly baseUrl: string;
  private readonly ownerId: string;
  private readonly occurrenceStore: OccurrenceStore | undefined;
  private readonly historySize: number;
  private readonly fetchImpl: FetchLike;
  private readonly api: JsonClient<typeof schedulerApiContract>;
  private readonly registry = new Map<string, RegistryEntry>();
  /** 本次进程启动的化身标识 + 单调代次（启动时刻毫秒），用于调度器侧 replace-all 防重启风暴。 */
  private readonly clientInstanceId = randomUUID();
  private readonly generation = Date.now();
  private started = false;
  private running = false;
  private controller: AbortController | null = null;

  public constructor({
    baseUrl,
    ownerId,
    occurrenceStore,
    historySize,
    fetch: fetchImpl,
  }: SchedulerClientDeps) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.ownerId = ownerId;
    this.occurrenceStore = occurrenceStore;
    this.historySize = historySize ?? DEFAULT_HISTORY_SIZE;
    this.fetchImpl = fetchImpl ?? fetch;
    this.api = createClient(schedulerApiContract, {
      baseUrl: this.baseUrl,
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      unreachableMessage: SCHEDULER_UNREACHABLE_MESSAGE,
    });
  }

  /** 注册一个任务（start 前）。同名重复注册报错。 */
  public register(reg: SchedulerTaskRegistration): void {
    if (this.started) {
      throw new Error(`cannot register task "${reg.name}" after scheduler client has started`);
    }
    if (this.registry.has(reg.name)) {
      throw new Error(`duplicate scheduled task name: ${reg.name}`);
    }
    if (reg.dedupe && this.occurrenceStore === undefined) {
      throw new Error(`task "${reg.name}" enables dedupe but no OccurrenceStore was provided`);
    }
    this.registry.set(reg.name, {
      reg,
      history: new TaskRunHistory({ capacity: this.historySize }),
      running: false,
      abortController: null,
      queuedTick: null,
    });
  }

  /** 启动后台注册 + 订阅循环（不阻塞）。 */
  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.running = true;
    void this.loop();
  }

  public stop(): void {
    this.running = false;
    this.controller?.abort();
    // 中断在跑的 handler（如 data-retention 大表分块删到一半），让它按 signal.aborted 收尾。
    for (const entry of this.registry.values()) {
      entry.abortController?.abort();
    }
  }

  /**
   * 人工触发：本地直接跑 handler（不走调度器、不走 SSE），本地 mutex 生效。manual 触发**绕过**
   * occurrence 去重（允许人工重跑 digest），也不写去重存储。
   */
  public async triggerNow(name: string): Promise<TriggerNowResult> {
    const entry = this.registry.get(name);
    if (!entry) {
      return { ok: false, reason: "unknown_task" };
    }
    if (entry.running) {
      return { ok: false, reason: "overlap" };
    }
    const now = new Date().toISOString();
    const tick: SchedulerTick = {
      taskName: name,
      occurrenceId: `${name}@${now}`,
      scheduledAt: now,
      emittedAt: now,
      manual: true,
    };
    await this.execute(entry, tick);
    return { ok: true };
  }

  /**
   * 合成一个任务的完整状态视图：schedule / recentRuns / isRunning 来自本地，nextRunAt 查调度器
   * status（不可达则降级 null）。web 观测页的数据源。
   */
  public async listStatus(): Promise<SchedulerTaskStatus[]> {
    const nextRunByName = new Map<string, string | null>();
    try {
      const res = await this.api.status({ ownerId: this.ownerId });
      for (const task of res.tasks) {
        nextRunByName.set(task.name, task.nextRunAt);
      }
    } catch (error) {
      logger.warn("scheduler status query failed, nextRunAt degraded to null", {
        event: "scheduler_client.status_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return [...this.registry.values()].map(entry => ({
      name: entry.reg.name,
      schedule: entry.reg.schedule,
      nextRunAt: nextRunByName.get(entry.reg.name) ?? null,
      isRunning: entry.running,
      recentRuns: entry.history.toArray().map(toWireRun),
    }));
  }

  // === 后台连接循环 ===

  private async loop(): Promise<void> {
    let backoffMs = INITIAL_BACKOFF_MS;
    while (this.running) {
      try {
        await this.connectOnce();
        backoffMs = INITIAL_BACKOFF_MS;
      } catch (error) {
        if (this.running) {
          logger.warn("scheduler connection dropped, will retry", {
            event: "scheduler_client.connection_dropped",
            backoffMs,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!this.running) {
        break;
      }
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  /** 一次连接：先 register（幂等 replace-all）再打开 SSE tick 流，读帧派发直到断开。 */
  private async connectOnce(): Promise<void> {
    const manifests: SchedulerTaskManifest[] = [...this.registry.values()].map(entry => {
      const manifest: SchedulerTaskManifest = {
        name: entry.reg.name,
        schedule: entry.reg.schedule,
        misfire: entry.reg.misfire,
      };
      if (entry.reg.maxCatchup !== undefined) {
        manifest.maxCatchup = entry.reg.maxCatchup;
      }
      return manifest;
    });
    const registered = await this.api.register({
      ownerId: this.ownerId,
      clientInstanceId: this.clientInstanceId,
      generation: this.generation,
      tasks: manifests,
    });
    if (!registered.accepted) {
      // 有更新化身抢先注册（generation 更大）：单 agent 下不该发生；记 warn 后仍尝试订阅
      // （同 ownerId 的 tick 仍是我们的任务、handler 也是同代码）。
      logger.warn("scheduler register rejected as stale, a newer instance exists", {
        event: "scheduler_client.register_stale",
        generation: this.generation,
        current: registered.current,
      });
    }

    const controller = new AbortController();
    this.controller = controller;

    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const armWatchdog = (): void => {
      if (watchdog !== null) {
        clearTimeout(watchdog);
      }
      watchdog = setTimeout(() => controller.abort(), DEAD_CONNECTION_TIMEOUT_MS);
      watchdog.unref?.();
    };

    try {
      armWatchdog();
      const url = `${this.baseUrl}${SCHEDULER_TICKS_SSE_PATH}?ownerId=${encodeURIComponent(this.ownerId)}`;
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) {
        throw new Error(`scheduler SSE responded ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        armWatchdog();
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          await this.handleFrame(frame);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } finally {
      if (watchdog !== null) {
        clearTimeout(watchdog);
      }
    }
  }

  private async handleFrame(frame: string): Promise<void> {
    let dataRaw: string | undefined;
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) {
        // 心跳注释帧：只喂看门狗，无内容。
        continue;
      }
      if (line.startsWith("data:")) {
        dataRaw = line.slice(5).trim();
      }
    }
    if (dataRaw === undefined) {
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(dataRaw);
    } catch {
      logger.warn("scheduler SSE frame data not JSON, skipped", {
        event: "scheduler_client.bad_frame",
      });
      return;
    }
    const parsed = SchedulerTickEventSchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn("scheduler SSE tick failed schema, skipped", {
        event: "scheduler_client.invalid_tick",
      });
      return;
    }
    await this.onTick({ ...parsed.data });
  }

  // === 派发 + 本地并发/去重 ===

  /** 收到一个 tick（SSE 或 triggerNow 合成）：经去重 + 本地 mutex/queue 守卫后跑 handler。 */
  public async onTick(tick: SchedulerTick): Promise<void> {
    const entry = this.registry.get(tick.taskName);
    if (!entry) {
      logger.warn("scheduler tick for unknown task, ignored", {
        event: "scheduler_client.unknown_task",
        taskName: tick.taskName,
      });
      return;
    }
    // occurrence 去重（manual 绕过）：已处理过（scheduledAt <= 已存）则丢弃。
    if (await this.isDuplicate(entry, tick)) {
      return;
    }
    if (entry.running) {
      if (entry.reg.overlap === "queue") {
        // 只留最新一个待补 tick（天然合并）。
        entry.queuedTick = tick;
        return;
      }
      entry.history.push(skippedOverlapRun());
      return;
    }
    await this.markSeen(entry, tick);
    await this.execute(entry, tick);
    // 排空 queue：跑完当前后补跑最新一个待补 tick（overlap=queue）。
    while (entry.queuedTick !== null) {
      const queued = entry.queuedTick;
      entry.queuedTick = null;
      if (await this.isDuplicate(entry, queued)) {
        continue;
      }
      await this.markSeen(entry, queued);
      await this.execute(entry, queued);
    }
  }

  private async isDuplicate(entry: RegistryEntry, tick: SchedulerTick): Promise<boolean> {
    if (tick.manual || !entry.reg.dedupe || this.occurrenceStore === undefined) {
      return false;
    }
    const last = await this.occurrenceStore.loadLastProcessed(entry.reg.name);
    return last !== null && tick.scheduledAt <= last;
  }

  /** 去重任务：跑 handler 前先落"已处理到此 scheduledAt"，保证跨崩溃/重连不重复处理（at-most-once）。 */
  private async markSeen(entry: RegistryEntry, tick: SchedulerTick): Promise<void> {
    if (tick.manual || !entry.reg.dedupe || this.occurrenceStore === undefined) {
      return;
    }
    await this.occurrenceStore.saveLastProcessed(entry.reg.name, tick.scheduledAt);
  }

  private async execute(entry: RegistryEntry, tick: SchedulerTick): Promise<void> {
    const abortController = new AbortController();
    const run: TaskRun = {
      startedAt: new Date(),
      finishedAt: null,
      durationMs: null,
      status: "running",
    };
    entry.running = true;
    entry.abortController = abortController;
    const startedAtMs = Date.now();
    try {
      const metadata = await entry.reg.handler(abortController.signal, tick);
      run.status = "success";
      if (metadata) {
        run.metadata = metadata;
      }
    } catch (error) {
      run.status = "error";
      run.errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("scheduled task handler failed", {
        event: "scheduler_client.task_failed",
        taskName: entry.reg.name,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      run.finishedAt = new Date();
      run.durationMs = Date.now() - startedAtMs;
      entry.running = false;
      entry.abortController = null;
      entry.history.push(run);
    }
  }
}

function skippedOverlapRun(): TaskRun {
  const now = new Date();
  return { startedAt: now, finishedAt: now, durationMs: 0, status: "skipped_overlap" };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
