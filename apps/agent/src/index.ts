import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { closeDb, type Database } from "@kagami/persistence/db/client";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { StdoutLogSink } from "@kagami/kernel/logger/sinks/stdout-sink";
import { buildServerRuntime } from "./app/server-runtime.js";
import type { FastifyInstance } from "fastify";
import type { TaskScheduler } from "./scheduler/application/task-scheduler.js";
import { shutdownServerResources, type AgentRuntimeController } from "./app/server-shutdown.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

initLoggerRuntime({
  sinks: [new StdoutLogSink()],
});

const logger = new AppLogger({ source: "bootstrap" });

let app: FastifyInstance | null = null;
let database: Database | null = null;
let shutdownApps: (() => Promise<void>) | null = null;
let taskScheduler: TaskScheduler | null = null;
let callbackServers: Array<{ stop(): Promise<void> }> = [];
let rootAgentRuntime: AgentRuntimeController | null = null;
let closeLlmProviders: (() => Promise<void>) | null = null;
let isServerStarted = false;
let isShuttingDown = false;
let port: number | null = null;

async function startAgentLoop(runtime: {
  rootAgentRuntime: {
    initialize(): Promise<void>;
    run(): Promise<void>;
    stop(): Promise<void>;
  };
}): Promise<void> {
  try {
    await runtime.rootAgentRuntime.initialize();
  } catch (error) {
    logger.errorWithCause(
      "Agent runtime initialization failed; backend will continue without agent loop",
      error,
      {
        event: "agent.loop.init_failed",
      },
    );
    return;
  }

  void runtime.rootAgentRuntime.run().catch(error => {
    logger.errorWithCause("Agent loop crashed; backend will continue without agent loop", error, {
      event: "agent.loop.crashed",
    });
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    logger.warn("Shutdown already in progress, ignoring repeated signal", {
      event: "server.shutdown.signal_ignored",
      signal,
    });
    return;
  }

  isShuttingDown = true;
  await shutdownServerResources({
    signal,
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
    isServerStarted,
    app,
    database,
    shutdownApps,
    taskScheduler,
    callbackServers,
    rootAgentRuntime,
    closeLlmProviders,
    closeDatabase: closeDb,
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  const runtime = await buildServerRuntime();
  app = runtime.app;
  database = runtime.database;
  shutdownApps = runtime.shutdownApps;
  taskScheduler = runtime.taskScheduler;
  callbackServers = runtime.callbackServers;
  rootAgentRuntime = runtime.rootAgentRuntime;
  closeLlmProviders = runtime.closeLlmProviders;
  port = runtime.port;

  // napcat 网关已收纳进 QQ App：在 buildServerRuntime 内随 App.onStartup 起好了，这里不再单独 start。
  await runtime.app.listen({ host: "0.0.0.0", port: runtime.port });
  runtime.taskScheduler.start();
  isServerStarted = true;

  // provider 列表现在经 HTTP 问 kagami-llm 服务，纯启动诊断用途。best-effort：服务此刻若还没起
  // （fresh deploy 时 PM2 可能先拉 agent），不能因此拖垮 agent 启动——真正的 LLM 调用在事件循环里
  // 发生、且走带退避的 LLM retry。这里失败只降级成空列表 + 一条 warn。
  const providers = await runtime.listAvailableAgentProviders().catch((error: unknown) => {
    logger.warn("Failed to list available providers at startup (llm service not ready?)", {
      event: "server.list_providers_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  });

  logger.info("Server started", {
    event: "server.started",
    port: runtime.port,
    pid: process.pid,
    providers,
    listenGroupIds: runtime.listenGroupIds,
    traceRuntimeEnabled: true,
  });

  void startAgentLoop(runtime);
} catch (error) {
  logger.errorWithCause("Failed to start server", error, {
    event: "server.start_failed",
    port,
  });

  if (database) {
    await closeDb(database).catch(closeError => {
      logger.errorWithCause("Failed to close database client after startup failure", closeError, {
        event: "server.start_failed.db_close_failed",
      });
    });
  }

  process.exit(1);
}
