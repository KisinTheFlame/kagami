import type { FastifyInstance } from "fastify";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { StdoutLogSink } from "@kagami/kernel/logger/sinks/stdout-sink";
import { closeDb, type Database } from "@kagami/persistence/db/client";
import { buildConsoleRuntime } from "./app/console-runtime.js";

// console 是只读查询进程：日志只走 stdout（不写 app_log，保持对 DB 只读），
// 自身请求日志由 PM2 的 console-out.log 承载即可。
initLoggerRuntime({
  sinks: [new StdoutLogSink()],
});

const logger = new AppLogger({ source: "console-bootstrap" });

let app: FastifyInstance | null = null;
let database: Database | null = null;
let isShuttingDown = false;
// 监听端口来自 config.yaml 的 services.console.port（由 buildConsoleRuntime 读出），
// 不再走 PM2 注入的 PORT env——服务寻址单一事实来源见 issue #162。
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
    logger.errorWithCause("Console shutdown error", error, {
      event: "console.shutdown.error",
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
  const runtime = await buildConsoleRuntime();
  app = runtime.app;
  database = runtime.database;
  port = runtime.port;

  await runtime.app.listen({ host: "0.0.0.0", port });

  logger.info("Console started", {
    event: "console.started",
    port,
    pid: process.pid,
  });
} catch (error) {
  logger.errorWithCause("Failed to start console", error, {
    event: "console.start_failed",
    port,
  });

  if (database) {
    await closeDb(database).catch(() => undefined);
  }

  process.exit(1);
}
