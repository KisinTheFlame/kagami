import type { FastifyInstance } from "fastify";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import { configureSqlite, createDbClient, type Database } from "@kagami/persistence/db/client";
import { PrismaMetricDao } from "@kagami/persistence/dao/impl/prisma-metric.impl.dao";
import { PrismaLlmObservabilityDao } from "@kagami/persistence/dao/impl/prisma-llm-observability.impl.dao";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { MetricChartHandler } from "../metric/http/metric-chart.handler.js";
import { MetricRecordHandler } from "../metric/http/metric-record.handler.js";
import { ObservabilityHandler } from "../metric/http/observability.handler.js";
import { DefaultMetricChartService } from "../metric/application/metric-chart.impl.service.js";
import { DefaultMetricRecordService } from "../metric/application/metric-record.impl.service.js";
import { DefaultLlmObservabilityService } from "../metric/application/llm-observability.impl.service.js";
import { PrismaMetricChartDao } from "../metric/infra/impl/prisma-metric-chart.impl.dao.js";

const logger = new AppLogger({ source: "metric-bootstrap" });

export type MetricRuntime = {
  app: FastifyInstance;
  database: Database;
  port: number;
};

/**
 * Metric 服务运行时装配。独立进程，一手包办 metric 摄取（`POST /metric/record`）与
 * metric-chart 查询（4 端点）。与 agent / console 经 `@kagami/persistence` 共享 Prisma DAO
 * 直读同一个 SQLite 库，靠库文件级 WAL 并发；不持有任何 Agent 活内存。
 */
export async function buildMetricRuntime(): Promise<MetricRuntime> {
  const config = await loadStaticConfig();

  const database = createDbClient({
    databaseUrl: config.server.databaseUrl,
  });
  // 与 agent / console 进程并发读写同一 SQLite 文件：开 WAL（库文件级持久设置，设一次长期生效）。
  await configureSqlite(database);

  const metricDao = new PrismaMetricDao({ database });
  const metricChartDao = new PrismaMetricChartDao({ database });
  const llmObservabilityDao = new PrismaLlmObservabilityDao({ database });

  const metricRecordService = new DefaultMetricRecordService({ metricDao });
  const metricChartService = new DefaultMetricChartService({
    metricDao,
    metricChartDao,
  });
  const llmObservabilityService = new DefaultLlmObservabilityService({ llmObservabilityDao });

  // 面向前端查询 + agent 摄取：traceId / 默认错误三分支由公共装配壳提供。
  const app = createServiceApp({
    logger,
    handlers: [
      new HealthHandler(),
      new MetricRecordHandler({ metricRecordService }),
      new MetricChartHandler({ metricChartService }),
      new ObservabilityHandler({ llmObservabilityService }),
    ],
  });

  return { app, database, port: config.services.metric.port };
}
