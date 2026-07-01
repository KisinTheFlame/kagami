import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import { configureSqlite, createDbClient, type Database } from "@kagami/persistence/db/client";
import { PrismaMetricDao } from "@kagami/persistence/dao/impl/prisma-metric.impl.dao";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { toHttpErrorResponse } from "@kagami/kernel/errors/http-error";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { withTraceContext } from "@kagami/kernel/logger/runtime";
import { HealthHandler } from "./http/health.handler.js";
import { MetricChartHandler } from "../metric/http/metric-chart.handler.js";
import { MetricRecordHandler } from "../metric/http/metric-record.handler.js";
import { DefaultMetricChartService } from "../metric/application/metric-chart.impl.service.js";
import { DefaultMetricRecordService } from "../metric/application/metric-record.impl.service.js";
import { PrismaMetricChartDao } from "../metric/infra/impl/prisma-metric-chart.impl.dao.js";

const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";
const logger = new AppLogger({ source: "metric-bootstrap" });

type AppRouteHandler = {
  register(app: FastifyInstance): void;
};

export type MetricRuntime = {
  app: FastifyInstance;
  database: Database;
  host: string;
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

  const metricRecordService = new DefaultMetricRecordService({ metricDao });
  const metricChartService = new DefaultMetricChartService({
    metricDao,
    metricChartDao,
  });

  const app = createMetricApp({
    handlers: [
      new HealthHandler(),
      new MetricRecordHandler({ metricRecordService }),
      new MetricChartHandler({ metricChartService }),
    ],
  });

  // metric 仅 localhost（同 oss / browser）：绑到 services.metric.host（127.0.0.1），
  // 不像 console/agent/gateway 那样绑 0.0.0.0——摄取端点无鉴权，绝不能暴露到其它网卡。
  return { app, database, host: config.services.metric.host, port: config.services.metric.port };
}

function createMetricApp({ handlers }: { handlers: AppRouteHandler[] }): FastifyInstance {
  const app = Fastify({ logger: false, disableRequestLogging: true });

  app.addHook("onRequest", (_request, reply, done) => {
    const traceId = randomUUID();
    reply.header(TRACE_ID_HEADER_NAME, traceId);

    withTraceContext(traceId, () => {
      done();
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      logger.warn("Request validation failed", {
        event: "http.request.validation_failed",
        method: request.method,
        url: request.url,
        issues: error.issues,
      });

      return reply.code(400).send({
        message: "请求参数不合法",
      });
    }

    if (error instanceof BizError) {
      logger.errorWithCause("Handled business request error", error, {
        event: "http.request.biz_error",
        method: request.method,
        url: request.url,
        ...(error.meta ?? {}),
      });

      const response = toHttpErrorResponse(error);
      return reply.code(response.statusCode).send(response.body);
    }

    logger.errorWithCause("Unhandled request error", error, {
      event: "http.request.unhandled_error",
      method: request.method,
      url: request.url,
    });

    return reply.code(500).send({
      message: "服务器内部错误",
    });
  });

  for (const handler of handlers) {
    handler.register(app);
  }

  return app;
}
