import type { FastifyInstance } from "fastify";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { StdoutLogSink } from "@kagami/kernel/logger/sinks/stdout-sink";
import { closeDb, type Database } from "@kagami/persistence/db/client";
import { buildBrowserRuntime } from "./app/browser-runtime.js";
import type { BrowserService } from "./application/browser.service.js";

// 浏览器进程：日志只走 stdout（不写 app_log，对 DB 只读 browser_credential），
// 请求日志由 PM2 的 browser-out.log 承载。
initLoggerRuntime({
  sinks: [new StdoutLogSink()],
});

const logger = new AppLogger({ source: "browser-bootstrap" });

// 关停硬上限：若有动作（如无超时的 eval）永不 settle，app.close() 会一直等活跃请求。
// 到点强退，避免 SIGTERM 下 context 不关、进程不退，只能靠 PM2/OS 强杀。
const SHUTDOWN_TIMEOUT_MS = 10_000;

let app: FastifyInstance | null = null;
let database: Database | null = null;
let service: BrowserService | null = null;
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
    if (service) {
      await service.shutdown();
    }
    if (database) {
      await closeDb(database);
    }
  } catch (error) {
    logger.errorWithCause("Browser shutdown error", error, {
      event: "browser.shutdown.error",
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
  const runtime = await buildBrowserRuntime();
  app = runtime.app;
  database = runtime.database;
  service = runtime.service;

  // 仅绑 127.0.0.1：API 暴露 /type secret / /eval / /screenshot，绝不对外网卡开放
  // （issue #173 安全边界）。
  await runtime.app.listen({ host: "127.0.0.1", port: runtime.port });
  logger.info("Browser process started", {
    event: "browser.started",
    port: runtime.port,
  });

  // 预热只下二进制、不开窗，削掉首个动作的延迟。放在 listen 之后后台跑：health 立即可用，
  // 首次下载（可能较慢）不阻塞启动。失败不致命（首动作时 lazy-launch 再降级提示）。
  void service.prewarm();
} catch (error) {
  logger.errorWithCause("Browser process failed to start", error, {
    event: "browser.start.failed",
  });
  process.exit(1);
}
