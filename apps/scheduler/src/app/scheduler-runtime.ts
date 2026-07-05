import type { FastifyInstance } from "fastify";
import { DefaultConfigManager } from "@kagami/kernel/config/config.impl.manager";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { SchedulerEngine } from "../application/scheduler-engine.js";
import { TickBroadcaster } from "../application/tick-broadcaster.js";
import { SchedulerRegisterHandler } from "../http/scheduler-register.handler.js";
import { SchedulerTicksHandler } from "../http/scheduler-ticks.handler.js";

const logger = new AppLogger({ source: "scheduler-bootstrap" });

export type SchedulerRuntime = {
  app: FastifyInstance;
  engine: SchedulerEngine;
  port: number;
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

  const app = createServiceApp({
    logger,
    handlers: [
      new HealthHandler(),
      new SchedulerRegisterHandler({ engine }),
      new SchedulerTicksHandler({ broadcaster, engine }),
    ],
  });

  return {
    app,
    engine,
    port: config.services.scheduler.port,
  };
}
