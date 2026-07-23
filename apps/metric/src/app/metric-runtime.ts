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
  const duckdbPath = resolveMetricDuckdbPath(config.server.databaseUrl);
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
 * metric 的 DuckDB 库落在仓库根 `data/metric/metric.duckdb`。从已解析的 sqlite 库路径
 * （`<repo>/data/agent/agent.db`）反推出 `<repo>/data` 目录。metric 已彻底脱离共享 SQLite /
 * Prisma（#475 P1），此处只借 databaseUrl 定位仓库 data 目录，不再连它。
 *
 * 依赖 loadStaticConfig 已把 databaseUrl 绝对化（锚 config.yaml 目录）。若收到相对路径则显式抛错，
 * 而非按进程 cwd 静默解析——kagami-metric 的 PM2 cwd 是 `apps/metric`，相对解析会把库落到
 * `apps/metric/data/` 造成 split-brain。
 */
function resolveMetricDuckdbPath(databaseUrl: string): string {
  const sqlitePath = databaseUrl.replace(/^file:/, "");
  if (!path.isAbsolute(sqlitePath)) {
    throw new Error(`metric DuckDB 需要绝对的 databaseUrl，收到相对路径：${databaseUrl}`);
  }
  const dataDir = path.dirname(path.dirname(sqlitePath));
  return path.join(dataDir, "metric", "metric.duckdb");
}
