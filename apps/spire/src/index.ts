import type { FastifyInstance } from "fastify";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { StdoutLogSink } from "@kagami/kernel/logger/sinks/stdout-sink";
import { buildSpireServiceRuntime } from "./app/spire-service-runtime.js";

// kagami-spire 进程：日志只走 stdout（同 browser/llm 卫星进程），由 PM2 的 spire-out.log 承载。
initLoggerRuntime({ sinks: [new StdoutLogSink()] });

const logger = new AppLogger({ source: "spire-service-bootstrap" });

const SHUTDOWN_TIMEOUT_MS = 10_000;

let app: FastifyInstance | null = null;
let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref();
  try {
    if (app) {
      await app.close();
    }
  } catch (error) {
    logger.errorWithCause("Spire service shutdown error", error, {
      event: "spire_service.shutdown.error",
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
  const runtime = await buildSpireServiceRuntime();
  app = runtime.app;
  // 仅绑 127.0.0.1：游戏接口只供本机 agent 调用，绝不对外网卡开放。
  await runtime.app.listen({ host: "127.0.0.1", port: runtime.port });
  logger.info("Spire service started", {
    event: "spire_service.started",
    port: runtime.port,
  });
} catch (error) {
  logger.errorWithCause("Spire service failed to start", error, {
    event: "spire_service.start.failed",
  });
  process.exit(1);
}
