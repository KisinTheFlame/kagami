import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { closeDb, type Database } from "@kagami/persistence/db/client";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { StdoutLogSink } from "@kagami/kernel/logger/sinks/stdout-sink";
import { buildServerRuntime } from "./app/server-runtime.js";
import type { FastifyInstance } from "fastify";
import type { SchedulerClient } from "@kagami/scheduler-client/scheduler-client";
import { shutdownServerResources, type AgentRuntimeController } from "./app/server-shutdown.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

initLoggerRuntime({
  sinks: [new StdoutLogSink()],
});

const logger = new AppLogger({ source: "bootstrap" });

let app: FastifyInstance | null = null;
let database: Database | null = null;
let shutdownApps: (() => Promise<void>) | null = null;
let schedulerClient: SchedulerClient | null = null;
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
    // 「Agent as a life」的硬底线：主循环是小镜"活着"的唯一形态。初始化失败绝不能让进程带着一个
    // 死循环继续在线（PM2 看进程健康、/health 照样 200、监控无感），那是"看着正常其实已经死了"。
    // fail-fast：best-effort 关停资源后非零退出，交给 PM2 拉起一个干净新进程（快照持久化扩展会在
    // 重启后重放历史、回填 KV 前缀）。
    await fatalExit("agent.loop.init_failed", "Agent runtime initialization failed", error);
    return;
  }

  void runtime.rootAgentRuntime.run().catch(error => {
    void fatalExit("agent.loop.crashed", "Agent loop crashed", error);
  });
}

/**
 * 主循环不可恢复地崩了（或初始化失败）：记致命日志 → best-effort 关停资源 → 非零退出让 PM2 重启。
 * 复用优雅关停编排（每步 best-effort、有超时兜底），但 exit code 强制为 1，让 pm2 logs / status
 * 明确显示这是一次崩溃而非干净停机。与 SIGINT/SIGTERM 共用 isShuttingDown 互斥，避免关停期间又崩
 * 触发二次关停。
 */
async function fatalExit(event: string, message: string, error: unknown): Promise<void> {
  logger.errorWithCause(`${message}; exiting for PM2 to restart`, error, { event });
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  await shutdownServerResources({
    signal: "SIGTERM",
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
    isServerStarted,
    app,
    database,
    shutdownApps,
    schedulerClient,
    callbackServers,
    rootAgentRuntime,
    closeLlmProviders,
    closeDatabase: closeDb,
    // 崩溃路径无论清理成功与否都以非零码退出（graceful 路径才 exit(0)）。
    exit: () => process.exit(1),
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
    schedulerClient,
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
  schedulerClient = runtime.schedulerClient;
  callbackServers = runtime.callbackServers;
  rootAgentRuntime = runtime.rootAgentRuntime;
  closeLlmProviders = runtime.closeLlmProviders;
  port = runtime.port;

  // napcat 网关已收纳进 QQ App：在 buildServerRuntime 内随 App.onStartup 起好了，这里不再单独 start。
  await runtime.app.listen({ host: "0.0.0.0", port: runtime.port });
  runtime.schedulerClient.start();
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
