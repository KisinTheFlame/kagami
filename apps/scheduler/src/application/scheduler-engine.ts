import { AppLogger } from "@kagami/kernel/logger/logger";
import type { SchedulerTickEvent } from "@kagami/scheduler-api/event";
import type {
  SchedulerRegisterRequest,
  SchedulerRegisterResponse,
  SchedulerStatusResponse,
  SchedulerTaskManifest,
} from "@kagami/scheduler-api/contract";
import type { SchedulerTaskSchedule } from "@kagami/scheduler-api/schedule";
import { CronDriver } from "../infra/cron-driver.js";
import { IntervalDriver } from "../infra/interval-driver.js";
import type { TickBroadcaster } from "./tick-broadcaster.js";

const logger = new AppLogger({ source: "scheduler.engine" });

type Driver = CronDriver | IntervalDriver;

/**
 * 一个活任务的 tick 侧状态（跨 owner 全局视图 #493 P4 用）：engine 拥有的部分——归属、名字、
 * 周期、下次触发。执行历史（isRunning / recentRuns）在 DB 侧，由 handler 左连接补齐。
 */
export type SchedulerActiveTask = {
  ownerId: string;
  name: string;
  schedule: SchedulerTaskSchedule;
  nextRunAt: string | null;
};

type TaskEntry = {
  manifest: SchedulerTaskManifest;
  driver: Driver;
  /** 上次触发（发/存 pending）的 scheduledAt。 */
  lastScheduledAt: Date | null;
  /** 上次实际投递到活连接的时刻。 */
  lastEmittedAt: Date | null;
  /** 无活连接时按 misfire 合并/累积的待发 tick。 */
  pending: SchedulerTickEvent[];
};

type OwnerState = {
  generation: number;
  clientInstanceId: string;
  /** owner 自报的反向回调根地址（统一触发 #493 P3）：scheduler 据此反向 POST 回 owner。 */
  callbackBaseUrl: string;
  tasks: Map<string, TaskEntry>;
};

/**
 * 通用调度引擎（issue #428）：多 owner 注册表 + cron/interval driver。到点 fire 时，有活连接就
 * 直接投递 tick，无连接则按 misfire 策略在内存缓存（drop/latest/catchup），(重)连时冲一次。
 * 不认识任何具体任务、不碰 DB——纯派生态，进程重启即丢，靠使用方重连重新注册恢复。
 */
export class SchedulerEngine {
  private readonly owners = new Map<string, OwnerState>();
  private readonly broadcaster: TickBroadcaster;

  public constructor({ broadcaster }: { broadcaster: TickBroadcaster }) {
    this.broadcaster = broadcaster;
  }

  /**
   * 注册：按 ownerId 做 replace-all。generation 落后于在册值 → in-band 拒绝（防重启风暴下旧请求
   * 覆盖新注册）。schedule 未变的任务复用原 driver + 状态（不重置 nextRun）；变了则重建；被移除
   * 的停 driver。
   */
  public register(request: SchedulerRegisterRequest): SchedulerRegisterResponse {
    const existing = this.owners.get(request.ownerId);
    if (existing && request.generation < existing.generation) {
      return { accepted: false, reason: "stale_generation", current: existing.generation };
    }

    const nextTasks = new Map<string, TaskEntry>();
    const incomingNames = new Set(request.tasks.map(task => task.name));

    for (const manifest of request.tasks) {
      const prev = existing?.tasks.get(manifest.name);
      if (prev && scheduleEqual(prev.manifest.schedule, manifest.schedule)) {
        // schedule 未变：复用 driver + nextRun + pending，只更新 misfire/maxCatchup。
        prev.manifest = manifest;
        nextTasks.set(manifest.name, prev);
        continue;
      }
      if (prev) {
        prev.driver.stop();
      }
      const entry = this.createEntry(request.ownerId, manifest);
      entry.driver.start();
      nextTasks.set(manifest.name, entry);
    }

    if (existing) {
      for (const [name, entry] of existing.tasks) {
        if (!incomingNames.has(name)) {
          entry.driver.stop();
        }
      }
    }

    this.owners.set(request.ownerId, {
      generation: request.generation,
      clientInstanceId: request.clientInstanceId,
      callbackBaseUrl: request.callbackBaseUrl,
      tasks: nextTasks,
    });
    logger.info("owner registered", {
      event: "scheduler.register",
      ownerId: request.ownerId,
      generation: request.generation,
      taskCount: nextTasks.size,
      taskNames: [...nextTasks.keys()],
    });
    return { accepted: true, generation: request.generation };
  }

  /** 一个 owner 的活连接建立后调用：把各任务缓存的 pending tick 冲给该 owner。 */
  public flushPending(ownerId: string): void {
    const owner = this.owners.get(ownerId);
    if (!owner) {
      return;
    }
    for (const entry of owner.tasks.values()) {
      if (entry.pending.length === 0) {
        continue;
      }
      const sorted = [...entry.pending].sort(
        (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
      );
      // 只清掉真正投递成功的；若连接在 flush 瞬间就断了（deliver 全失败），保留 pending 等下次连接，
      // 不静默丢 tick。
      const remaining: SchedulerTickEvent[] = [];
      let deliveredAny = false;
      for (const tick of sorted) {
        if (this.broadcaster.deliver(ownerId, tick)) {
          deliveredAny = true;
        } else {
          remaining.push(tick);
        }
      }
      if (deliveredAny) {
        entry.lastEmittedAt = new Date();
      }
      entry.pending = remaining;
    }
  }

  public status(ownerId: string): SchedulerStatusResponse {
    const owner = this.owners.get(ownerId);
    if (!owner) {
      return { tasks: [] };
    }
    return {
      tasks: [...owner.tasks.values()].map(entry => ({
        name: entry.manifest.name,
        schedule: entry.manifest.schedule,
        nextRunAt: entry.driver.peekNextRun()?.toISOString() ?? null,
        lastScheduledAt: entry.lastScheduledAt ? entry.lastScheduledAt.toISOString() : null,
        lastEmittedAt: entry.lastEmittedAt ? entry.lastEmittedAt.toISOString() : null,
      })),
    };
  }

  /**
   * 跨全部 owner 列出活任务的 tick 侧状态（全局观测视图 #493 P4）。status(ownerId) 的多 owner 版：
   * 前端不再逐 owner 查，而是一次拿全部活任务，再由 handler 左连接执行历史。engine 是纯派生态，
   * 只知道「谁有哪些任务、下次何时触发」，不碰 DB。
   */
  public listActiveTasks(): SchedulerActiveTask[] {
    const result: SchedulerActiveTask[] = [];
    for (const [ownerId, owner] of this.owners) {
      for (const entry of owner.tasks.values()) {
        result.push({
          ownerId,
          name: entry.manifest.name,
          schedule: entry.manifest.schedule,
          nextRunAt: entry.driver.peekNextRun()?.toISOString() ?? null,
        });
      }
    }
    return result;
  }

  /**
   * 查一个 owner 自报的反向回调根地址（统一触发 #493 P3）。未注册 / 未连过 → null，触发入口据此
   * 直接回 owner_unreachable。
   */
  public getCallbackBaseUrl(ownerId: string): string | null {
    return this.owners.get(ownerId)?.callbackBaseUrl ?? null;
  }

  /** 停掉所有 driver（进程关停）。in-flight 的 handler 在使用方进程，与本引擎无关。 */
  public stop(): void {
    for (const owner of this.owners.values()) {
      for (const entry of owner.tasks.values()) {
        entry.driver.stop();
      }
    }
  }

  private createEntry(ownerId: string, manifest: SchedulerTaskManifest): TaskEntry {
    const entry: TaskEntry = {
      manifest,
      driver: this.createDriver(manifest.schedule, () => this.onFire(ownerId, manifest.name)),
      lastScheduledAt: null,
      lastEmittedAt: null,
      pending: [],
    };
    return entry;
  }

  private createDriver(schedule: SchedulerTaskSchedule, onFire: () => void): Driver {
    if (schedule.kind === "cron") {
      return new CronDriver({ expression: schedule.expression, handler: onFire });
    }
    return new IntervalDriver({
      intervalMs: schedule.intervalMs,
      initialDelayMs: schedule.initialDelayMs ?? 0,
      handler: onFire,
    });
  }

  private onFire(ownerId: string, name: string): void {
    const owner = this.owners.get(ownerId);
    if (!owner) {
      return;
    }
    const entry = owner.tasks.get(name);
    if (!entry) {
      return;
    }
    const now = new Date();
    const nowIso = now.toISOString();
    entry.lastScheduledAt = now;
    const tick: SchedulerTickEvent = {
      taskName: name,
      occurrenceId: `${name}@${nowIso}`,
      scheduledAt: nowIso,
      emittedAt: nowIso,
      manual: false,
    };
    if (this.broadcaster.deliver(ownerId, tick)) {
      entry.lastEmittedAt = now;
      return;
    }
    this.bufferPending(entry, tick);
  }

  private bufferPending(entry: TaskEntry, tick: SchedulerTickEvent): void {
    switch (entry.manifest.misfire) {
      case "drop":
        return;
      case "latest":
        entry.pending = [tick];
        return;
      case "catchup": {
        const max = entry.manifest.maxCatchup ?? 1;
        entry.pending.push(tick);
        entry.pending.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
        if (entry.pending.length > max) {
          entry.pending = entry.pending.slice(entry.pending.length - max);
        }
        return;
      }
    }
  }
}

function scheduleEqual(a: SchedulerTaskSchedule, b: SchedulerTaskSchedule): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "cron" && b.kind === "cron") {
    return a.expression === b.expression;
  }
  if (a.kind === "interval" && b.kind === "interval") {
    return a.intervalMs === b.intervalMs && (a.initialDelayMs ?? 0) === (b.initialDelayMs ?? 0);
  }
  return false;
}
