import type { FastifyInstance } from "fastify";
import { DefaultConfigManager } from "@kagami/kernel/config/config.impl.manager";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { SchedulerEngine } from "../application/scheduler-engine.js";
import { TickBroadcaster } from "../application/tick-broadcaster.js";
import { SchedulerRegisterHandler } from "../http/scheduler-register.handler.js";
import { SchedulerRunsHandler } from "../http/scheduler-runs.handler.js";
import { SchedulerTasksViewHandler } from "../http/scheduler-tasks-view.handler.js";
import { SchedulerTicksHandler } from "../http/scheduler-ticks.handler.js";
import { SchedulerTriggerHandler } from "../http/scheduler-trigger.handler.js";
import { closeDb, configureSqlite, createDbClient, type Database } from "../infra/db/client.js";
import { TaskRunStore } from "../infra/db/task-run-store.js";

const logger = new AppLogger({ source: "scheduler-bootstrap" });

// 历史 GC 周期（#493 P2）：启动后延迟一个周期再首跑，避免启动风暴。
const HISTORY_GC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type SchedulerRuntime = {
  app: FastifyInstance;
  engine: SchedulerEngine;
  database: Database;
  port: number;
  /** 关停时清掉历史 GC 定时器。 */
  stopHistoryGc: () => void;
};

/**
 * kagami-scheduler 进程运行时装配（issue #428）。通用薄时钟：无 DB、无业务语义。持有 driver 注册表
 * （引擎）+ SSE tick 广播器；使用方经 register 注册、经 SSE 收 tick。agent 频繁重启不打断本进程的
 * 计时节奏（虽然对无状态调度器收益薄，但作为通用能力独立成服务）。
 */
export async function buildSchedulerRuntime(): Promise<SchedulerRuntime> {
  const loadedConfig = await loadStaticConfig();
  const configManager = new DefaultConfigManager({ config: loadedConfig });
  const config = await configManager.config();

  const broadcaster = new TickBroadcaster();
  const engine = new SchedulerEngine({ broadcaster });

  // scheduler 独占的 Prisma 库（issue #493）：TaskRun 执行历史。启动即建 client + 开 WAL。
  const database = createDbClient({ databaseUrl: config.services.scheduler.databaseUrl });
  await configureSqlite(database);
  const store = new TaskRunStore({ database });

  const app = createServiceApp({
    logger,
    handlers: [
      new HealthHandler(),
      new SchedulerRegisterHandler({ engine, store }),
      new SchedulerTicksHandler({ broadcaster, engine }),
      new SchedulerRunsHandler({ store }),
      new SchedulerTasksViewHandler({ engine, store }),
      new SchedulerTriggerHandler({ engine }),
    ],
  });

  // 历史 GC（#493 P2）：进程内周期 prune TaskRun。延迟一个周期首跑避免启动风暴；unref 不挡进程退出。
  const retentionCount = config.services.scheduler.historyRetentionCount;
  const retentionDays = config.services.scheduler.historyRetentionDays;
  const historyGcTimer = setInterval(() => {
    void store.pruneHistory({ retentionCount, retentionDays }).catch(error => {
      logger.warn("scheduler history GC failed", {
        event: "scheduler.history_gc_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, HISTORY_GC_INTERVAL_MS);
  historyGcTimer.unref?.();

  return {
    app,
    engine,
    database,
    port: config.services.scheduler.port,
    stopHistoryGc: () => clearInterval(historyGcTimer),
  };
}

export { closeDb };
