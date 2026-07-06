import { randomUUID } from "node:crypto";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { schedulerApiContract, type SchedulerTaskManifest } from "@kagami/scheduler-api/contract";
import { SchedulerTickEventSchema, SCHEDULER_TICKS_SSE_PATH } from "@kagami/scheduler-api/event";
import type { SchedulerReportRunRequest } from "@kagami/scheduler-api/run";
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
// 未 ack 的 run 上报缓冲上限（#493 P2）：内存 at-least-once，超量丢最旧并 warn。
const UNACKED_REPORT_BUFFER_CAP = 100;

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
  /**
   * 未 ack 的 run 上报缓冲（#493 P2）：内存 at-least-once，无磁盘 outbox。按 runId 去重合并——同一
   * runId 的 running 后又来 terminal 只留最新那条（terminal 覆盖 running，避免重推把终态退回 running）。
   * 上报失败留在这里，下次上报前 + register 重连后各 flush 一次；scheduler 侧幂等 upsert 保证重推安全。
   */
  private readonly unackedReports = new Map<string, SchedulerReportRunRequest>();
  /**
   * 在途的 run 上报 promise（#493 P2）：回报是**旁路遥测**，绝不能挤上 handler 的关键路径。故
   * runHandler 只 fire-and-forget 派发上报（不 await），把 promise 记在这里；`settleReports` 供测试
   * 与将来的 graceful drain 等待其排空。回报本身永不抛（reportRun 内部 catch + 缓冲）。
   */
  private readonly pendingReports = new Set<Promise<void>>();

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
    // 运行中判定 + 占锁全程同步（同 onTick），保证与 SSE tick 互不并跑。
    if (entry.running) {
      return { ok: false, reason: "overlap" };
    }
    entry.running = true;
    const now = new Date().toISOString();
    const tick: SchedulerTick = {
      taskName: name,
      occurrenceId: `${name}@${now}`,
      scheduledAt: now,
      emittedAt: now,
      manual: true,
    };
    try {
      await this.runClaimed(entry, tick);
    } finally {
      entry.running = false;
      entry.abortController = null;
    }
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
      // 有更新化身抢先注册（generation 更大）：单 agent 下不该发生。**不订阅** SSE，否则旧化身会
      // 与新化身同时收 tick 重复执行；退出本次连接，交给 loop 退避重试。
      logger.warn(
        "scheduler register rejected as stale, not subscribing (a newer instance owns it)",
        {
          event: "scheduler_client.register_stale",
          generation: this.generation,
          current: registered.current,
        },
      );
      return;
    }

    // 重连成功（SSE 即将订阅）：把断连期间攒下的未 ack 上报冲一次。
    await this.flushUnackedReports();

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
    // 不 await：长任务 handler（如 data-retention 分块删）不能阻塞 SSE 读循环，否则读不到心跳会
    // 触发假死重连。派发出去即返回，reader 继续喂看门狗；同任务并发由 onTick 的同步 running 锁挡住。
    void this.onTick({ ...parsed.data }).catch(error => {
      logger.warn("scheduler tick dispatch failed", {
        event: "scheduler_client.dispatch_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  // === 派发 + 本地并发/去重 ===

  /** 收到一个 tick（SSE 或 triggerNow 合成）：经本地 mutex/queue 守卫后去重并跑 handler。 */
  public async onTick(tick: SchedulerTick): Promise<void> {
    const entry = this.registry.get(tick.taskName);
    if (!entry) {
      logger.warn("scheduler tick for unknown task, ignored", {
        event: "scheduler_client.unknown_task",
        taskName: tick.taskName,
      });
      return;
    }
    // 运行中判定 + 占锁**全程同步**（无 await 间隙），杜绝并发 tick / triggerNow 对同一任务并跑。
    if (entry.running) {
      if (entry.reg.overlap === "queue") {
        entry.queuedTick = tick; // 只留最新一个待补 tick（天然合并）。
        return;
      }
      entry.history.push(skippedOverlapRun());
      return;
    }
    entry.running = true;
    try {
      await this.runClaimed(entry, tick);
    } finally {
      entry.running = false;
      entry.abortController = null;
    }
  }

  /**
   * 已持有 running 锁后的处理：去重（manual 绕过）→ 跑 handler → 成功才推进去重游标 → 排空 queue
   * （overlap=queue 才有）。占锁在调用方（onTick / triggerNow）同步完成，这里全程独占，无并发。
   */
  private async runClaimed(entry: RegistryEntry, tick: SchedulerTick): Promise<void> {
    let current: SchedulerTick | null = tick;
    while (current !== null) {
      const next = current;
      current = null;
      if (!(await this.isDuplicate(entry, next))) {
        const succeeded = await this.runHandler(entry, next);
        // handler 成功后才落"已处理到此 scheduledAt"：失败**不**推进游标，留给重连补发重试
        // （at-least-once）。补偿型 dedupe 任务（如 todo:daily-digest）宁可极罕见重推一次，也不能因
        // 一次 handler 抛错就把整次派生生活输入静默吞掉。
        if (succeeded) {
          await this.markSeen(entry, next);
        }
      }
      if (entry.queuedTick !== null) {
        current = entry.queuedTick;
        entry.queuedTick = null;
      }
    }
  }

  private async isDuplicate(entry: RegistryEntry, tick: SchedulerTick): Promise<boolean> {
    if (tick.manual || !entry.reg.dedupe || this.occurrenceStore === undefined) {
      return false;
    }
    const last = await this.occurrenceStore.loadLastProcessed(entry.reg.name);
    return last !== null && tick.scheduledAt <= last;
  }

  /** 去重任务：handler 成功后落"已处理到此 scheduledAt"，跨崩溃/重连据此跳过已成功的 occurrence。 */
  private async markSeen(entry: RegistryEntry, tick: SchedulerTick): Promise<void> {
    if (tick.manual || !entry.reg.dedupe || this.occurrenceStore === undefined) {
      return;
    }
    await this.occurrenceStore.saveLastProcessed(entry.reg.name, tick.scheduledAt);
  }

  /**
   * 跑一次 handler 并记录执行历史。返回 handler 是否成功（供 runClaimed 决定要不要推进去重游标）。
   * running 锁的占用/释放归调用方（onTick / triggerNow）。
   *
   * 两阶段回报（#493 P2）：开始时生成 runId 上报一次 running，结束时用**同一 runId**再上报终态
   * （success/failure）。上报失败进未 ack 缓冲、绝不阻塞 handler 主流程结果。只有真跑了的 run 才回报——
   * skipped_overlap 从没真跑（且 wire 无此枚举），不在这里产生。
   */
  private async runHandler(entry: RegistryEntry, tick: SchedulerTick): Promise<boolean> {
    const abortController = new AbortController();
    const runId = randomUUID();
    const startedAt = new Date();
    const run: TaskRun = {
      startedAt,
      finishedAt: null,
      durationMs: null,
      status: "running",
    };
    entry.abortController = abortController;
    const startedAtMs = Date.now();
    const trigger: SchedulerReportRunRequest["trigger"] = tick.manual ? "manual" : "scheduled";
    const startedAtIso = startedAt.toISOString();
    // 开始：上报 running（scheduledAt 仅 scheduled 触发有意义，manual 为 null）。
    // fire-and-forget：绝不 await——回报是旁路遥测，不能阻塞 handler 启动（scheduler 不可达时
    // reportRun 会走满 30s 超时）。失败自动进未 ack 缓冲，靠状态感知 upsert 保序、幂等重推。
    const runningReport = this.reportRun({
      id: runId,
      ownerId: this.ownerId,
      taskName: entry.reg.name,
      ownerGeneration: this.generation,
      status: "running",
      trigger,
      scheduledAt: tick.manual ? null : tick.scheduledAt,
      startedAt: startedAtIso,
      finishedAt: null,
      durationMs: null,
      error: null,
    });
    this.trackReport(runningReport);
    try {
      const metadata = await entry.reg.handler(abortController.signal, tick);
      run.status = "success";
      if (metadata) {
        run.metadata = metadata;
      }
      return true;
    } catch (error) {
      run.status = "error";
      run.errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("scheduled task handler failed", {
        event: "scheduler_client.task_failed",
        taskName: entry.reg.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      const finishedAt = new Date();
      run.finishedAt = finishedAt;
      run.durationMs = Date.now() - startedAtMs;
      const finishedAtIso = finishedAt.toISOString();
      const durationMs = run.durationMs;
      entry.history.push(run);
      // 结束：同 runId 再上报终态（本地 error → wire failure）。同样不阻塞 handler（此刻 handler 已
      // 返回），但**chain 在 running 上报之后**——保证同一 run 的两次上报有序：running 先落库/先进缓冲，
      // terminal 的 flush 才能带上它，否则 instant handler 下二者并发竞争会让失败的 running 滞留缓冲。
      // running 上报永不抛，故 .then 恒执行。若进程恰在终态 POST in-flight 时 stop（既没进缓冲也没
      // 落库），该 run 停在 running，靠下次异代重连的 markInterruptedBelow 兜底标 interrupted——这正是
      // interrupted 自愈的设计目的。
      const terminalStatus = run.status === "success" ? "success" : "failure";
      this.trackReport(
        runningReport.then(() =>
          this.reportRun({
            id: runId,
            ownerId: this.ownerId,
            taskName: entry.reg.name,
            ownerGeneration: this.generation,
            status: terminalStatus,
            trigger,
            scheduledAt: tick.manual ? null : tick.scheduledAt,
            startedAt: startedAtIso,
            finishedAt: finishedAtIso,
            durationMs,
            error: run.errorMessage ?? null,
          }),
        ),
      );
    }
  }

  // === run 上报（两阶段回报 + 未 ack 缓冲，#493 P2）===

  /** 追踪一个在途上报 promise，完成即摘除。回报永不抛，故无需 catch。 */
  private trackReport(promise: Promise<void>): void {
    this.pendingReports.add(promise);
    void promise.finally(() => this.pendingReports.delete(promise));
  }

  /** 等所有在途上报排空（测试与将来的 graceful drain 用）。等待期间新增的上报也一并等到。 */
  public async settleReports(): Promise<void> {
    while (this.pendingReports.size > 0) {
      await Promise.all([...this.pendingReports]);
    }
  }

  /**
   * 上报一条 run 执行历史。上报**永不抛**（不能让上报失败搞崩 handler 主流程）：先 flush 未 ack 缓冲，
   * 再 POST 本条；失败则进缓冲等重推。同 runId 去重合并（terminal 覆盖 running）由 buffer 保证。
   */
  private async reportRun(payload: SchedulerReportRunRequest): Promise<void> {
    // 先尝试冲掉此前攒下的未 ack 上报，保序（旧的先走）。
    await this.flushUnackedReports();
    try {
      await this.api.reportRun(payload);
    } catch (error) {
      this.bufferUnackedReport(payload);
      logger.warn("scheduler run report failed, buffered for retry", {
        event: "scheduler_client.report_failed",
        taskName: payload.taskName,
        status: payload.status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 把一条上报放进未 ack 缓冲：按 runId 去重合并（后到覆盖），超量丢最旧并 warn。 */
  private bufferUnackedReport(payload: SchedulerReportRunRequest): void {
    // 已存在同 runId 先删再插，让它落到 Map 末尾（保持插入序 = 重推序，terminal 覆盖 running）。
    this.unackedReports.delete(payload.id);
    this.unackedReports.set(payload.id, payload);
    while (this.unackedReports.size > UNACKED_REPORT_BUFFER_CAP) {
      const oldest = this.unackedReports.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.unackedReports.delete(oldest);
      logger.warn("scheduler unacked report buffer full, dropped oldest", {
        event: "scheduler_client.report_buffer_overflow",
        droppedRunId: oldest,
      });
    }
  }

  /** 冲一次未 ack 缓冲：逐条重推，成功的移除，失败的留下等下次；重推安全（scheduler 幂等）。 */
  private async flushUnackedReports(): Promise<void> {
    if (this.unackedReports.size === 0) {
      return;
    }
    for (const [runId, payload] of [...this.unackedReports]) {
      try {
        await this.api.reportRun(payload);
        // compare-and-delete：只在这条仍是缓冲里那一条时才删。await 期间另一个 handler 可能已把同
        // runId 换成更新的 terminal（bufferUnackedReport 的 delete+set）——那时无条件 delete 会把
        // terminal 误删、让 run 永远停在 running。用引用相等守住：被替换了就不删，留给下次 flush。
        if (this.unackedReports.get(runId) === payload) {
          this.unackedReports.delete(runId);
        }
      } catch {
        // 仍失败：留在缓冲，下次再冲。中止本轮 flush（连接大概率还没恢复），避免空转。
        return;
      }
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
