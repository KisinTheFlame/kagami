import { mkdirSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { MetricChartHandler } from "../metric/http/metric-chart.handler.js";
import { MetricDeriveHandler } from "../metric/http/metric-derive.handler.js";
import { MetricPointsHandler } from "../metric/http/metric-points.handler.js";
import { MetricRecordHandler } from "../metric/http/metric-record.handler.js";
import { DefaultMetricChartService } from "../metric/application/metric-chart.impl.service.js";
import { DefaultMetricDeriveService } from "../metric/application/metric-derive.impl.service.js";
import { DefaultMetricPointsService } from "../metric/application/metric-points.impl.service.js";
import { DefaultMetricRecordService } from "../metric/application/metric-record.impl.service.js";
import { openMetricDuckDb } from "../metric/infra/impl/duckdb-metric.impl.dao.js";

const logger = new AppLogger({ source: "metric-bootstrap" });

export type MetricRuntime = {
  app: FastifyInstance;
  close: () => void;
  port: number;
};

/**
 * Metric 服务运行时装配。独立进程，一手包办 metric 摄取（`POST /metric/record`）与 metric 图表查询
 * （`POST /metric/query`，内联聚合规格）。#475 P1 起 metric 从共享 SQLite / Prisma 迁到
 * **kagami-metric 独占的 DuckDB 单文件**（列式，为 p95 / 分析聚合而生）；不再与其它进程共享库，
 * 也不持有任何 Agent 活内存。
 */
export async function buildMetricRuntime(): Promise<MetricRuntime> {
  const config = await loadStaticConfig();
  const duckdbPath = resolveMetricDuckdbPath(config.services.metric.databaseUrl);
  mkdirSync(path.dirname(duckdbPath), { recursive: true });

  const metricDao = await openMetricDuckDb(duckdbPath);

  const metricRecordService = new DefaultMetricRecordService({ metricDao });
  const metricChartService = new DefaultMetricChartService({ metricDao });
  const metricDeriveService = new DefaultMetricDeriveService({ metricDao });
  const metricPointsService = new DefaultMetricPointsService({ metricDao });

  // 面向前端查询 + agent 摄取：traceId / 默认错误三分支由公共装配壳提供。
  const app = createServiceApp({
    logger,
    handlers: [
      new HealthHandler(),
      new MetricRecordHandler({ metricRecordService }),
      new MetricChartHandler({ metricChartService }),
      new MetricDeriveHandler({ metricDeriveService }),
      new MetricPointsHandler({ metricPointsService }),
    ],
  });

  return { app, close: () => metricDao.close(), port: config.services.metric.port };
}

/**
 * metric 的 DuckDB 库路径由 `services.metric.databaseUrl` 显式配置（`file:./data/metric/metric.duckdb`），
 * 不再借 agent 主库 databaseUrl 反推——那会让「移动 agent 主库」隐式移动 metric 库、违背「DB 按服务
 * 独立」（#475/#539）。
 *
 * 依赖 loadStaticConfig 已把 databaseUrl 绝对化（锚 config.yaml 目录）。若收到相对路径则显式抛错，
 * 而非按进程 cwd 静默解析——kagami-metric 的 PM2 cwd 是 `apps/metric`，相对解析会把库落到
 * `apps/metric/data/` 造成 split-brain。
 */
function resolveMetricDuckdbPath(databaseUrl: string): string {
  const duckdbPath = databaseUrl.replace(/^file:/, "");
  if (!path.isAbsolute(duckdbPath)) {
    throw new Error(`metric DuckDB 需要绝对的 databaseUrl，收到相对路径：${databaseUrl}`);
  }
  return duckdbPath;
}
