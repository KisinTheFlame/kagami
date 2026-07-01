import type { FastifyInstance } from "fastify";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { StdoutLogSink } from "@kagami/kernel/logger/sinks/stdout-sink";
import { closeDb, type Database } from "@kagami/persistence/db/client";
import { buildMetricRuntime } from "./app/metric-runtime.js";

// metric 是独立的 metric 领域进程：日志只走 stdout（不写 app_log，保持对 DB 只写 metric 表），
// 自身请求日志由 PM2 的 metric-out.log 承载即可。
initLoggerRuntime({
  sinks: [new StdoutLogSink()],
});

const logger = new AppLogger({ source: "metric-bootstrap" });

let app: FastifyInstance | null = null;
let database: Database | null = null;
let isShuttingDown = false;
// 监听地址来自 config.yaml 的 services.metric（由 buildMetricRuntime 读出），
// 不走 PM2 注入的 PORT env——服务寻址单一事实来源见 issue #162。
let host: string | undefined;
let port: number | undefined;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  try {
    if (app) {
      await app.close();
    }
    if (database) {
      await closeDb(database);
    }
  } catch (error) {
    logger.errorWithCause("Metric shutdown error", error, {
      event: "metric.shutdown.error",
      signal,
    });
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  const runtime = await buildMetricRuntime();
  app = runtime.app;
  database = runtime.database;
  host = runtime.host;
  port = runtime.port;

  await runtime.app.listen({ host, port });

  logger.info("Metric started", {
    event: "metric.started",
    host,
    port,
    pid: process.pid,
  });
} catch (error) {
  logger.errorWithCause("Failed to start metric", error, {
    event: "metric.start_failed",
    port,
  });

  if (database) {
    await closeDb(database).catch(() => undefined);
  }

  process.exit(1);
}
