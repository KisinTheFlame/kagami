import type { FastifyInstance } from "fastify";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { StdoutLogSink } from "@kagami/kernel/logger/sinks/stdout-sink";
import { closeDb, type Database } from "@kagami/persistence/db/client";
import { buildLlmServiceRuntime } from "./app/llm-service-runtime.js";
import type { AuthRefreshTimers } from "./app/auth-refresh-timers.js";

// kagami-llm 进程：日志只走 stdout（同 browser/oss 卫星进程），请求日志由 PM2 的
// llm-out.log 承载。对 DB 的写只有 llm_chat_call / auth 表 / embedding_cache（数据，非日志）。
initLoggerRuntime({
  sinks: [new StdoutLogSink()],
});

const logger = new AppLogger({ source: "llm-service-bootstrap" });

const SHUTDOWN_TIMEOUT_MS = 10_000;

let app: FastifyInstance | null = null;
let database: Database | null = null;
let callbackServers: Array<{ stop(): Promise<void> }> = [];
let authRefreshTimers: AuthRefreshTimers | null = null;
let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref();
  try {
    authRefreshTimers?.stop();
    if (app) {
      await app.close();
    }
    await Promise.all(callbackServers.map(server => server.stop()));
    if (database) {
      await closeDb(database);
    }
  } catch (error) {
    logger.errorWithCause("LLM service shutdown error", error, {
      event: "llm_service.shutdown.error",
      signal,
    });
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  const runtime = await buildLlmServiceRuntime();
  app = runtime.app;
  database = runtime.database;
  callbackServers = runtime.callbackServers;
  authRefreshTimers = runtime.authRefreshTimers;

  // 仅绑 127.0.0.1：/internal/* 与 /auth/* 只供本机 agent / gateway 调用，绝不对外网卡开放。
  await runtime.app.listen({ host: "127.0.0.1", port: runtime.port });
  logger.info("LLM service started", {
    event: "llm_service.started",
    port: runtime.port,
  });
} catch (error) {
  logger.errorWithCause("LLM service failed to start", error, {
    event: "llm_service.start.failed",
  });
  process.exit(1);
}
