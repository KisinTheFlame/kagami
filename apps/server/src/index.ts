import { initLoggerRuntime } from "./logger/runtime.js";
import { closeDb, type Database } from "./db/client.js";
import { AppLogger } from "./logger/logger.js";
import { StdoutLogSink } from "./logger/sinks/stdout-sink.js";
import { buildServerRuntime } from "./app/server-runtime.js";
import type { FastifyInstance } from "fastify";
import type { NapcatGatewayService } from "./napcat/service/napcat-gateway.service.js";
import type { AuthUsageCacheManager } from "./auth/application/auth-usage-cache.impl.service.js";
import type { ClaudeCodeAuthRefreshScheduler } from "./auth/application/claude-code-auth-refresh.scheduler.js";
import type { IthomePoller } from "./news/application/ithome-poller.js";
import { shutdownServerResources, type AgentRuntimeController } from "./app/server-shutdown.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

initLoggerRuntime({
  sinks: [new StdoutLogSink()],
});

const logger = new AppLogger({ source: "bootstrap" });

let app: FastifyInstance | null = null;
let database: Database | null = null;
let napcatGatewayService: NapcatGatewayService | null = null;
let ithomePoller: IthomePoller | null = null;
let callbackServers: Array<{ stop(): Promise<void> }> = [];
let authUsageCacheManager: AuthUsageCacheManager | null = null;
let claudeCodeAuthRefreshScheduler: ClaudeCodeAuthRefreshScheduler | null = null;
let rootAgentRuntime: AgentRuntimeController | null = null;
let storyAgentRuntime: AgentRuntimeController | null = null;
let closeLlmProviders: (() => Promise<void>) | null = null;
let isServerStarted = false;
let isShuttingDown = false;
let port: number | null = null;

async function startAgentLoop(runtime: {
  restoredRootAgentSnapshot: boolean;
  hydrateColdStartAgentContext(): Promise<void>;
  storyAgentRuntime: {
    initialize(): Promise<void>;
    run(): Promise<void>;
    stop(): Promise<void>;
  };
  rootAgentRuntime: {
    initialize(): Promise<void>;
    run(): Promise<void>;
    stop(): Promise<void>;
  };
}): Promise<void> {
  try {
    if (!runtime.restoredRootAgentSnapshot) {
      await runtime.hydrateColdStartAgentContext();
    }

    await runtime.rootAgentRuntime.initialize();
    await runtime.storyAgentRuntime.initialize();
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

  void runtime.storyAgentRuntime.run().catch(error => {
    logger.errorWithCause("Story loop crashed; backend will continue without story loop", error, {
      event: "agent.story_loop.crashed",
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
    napcatGatewayService,
    ithomePoller,
    callbackServers,
    authUsageCacheManager,
    claudeCodeAuthRefreshScheduler,
    rootAgentRuntime,
    storyAgentRuntime,
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
  napcatGatewayService = runtime.napcatGatewayService;
  ithomePoller = runtime.ithomePoller;
  callbackServers = runtime.callbackServers;
  authUsageCacheManager = runtime.authUsageCacheManager;
  claudeCodeAuthRefreshScheduler = runtime.claudeCodeAuthRefreshScheduler;
  rootAgentRuntime = runtime.rootAgentRuntime;
  storyAgentRuntime = runtime.storyAgentRuntime;
  closeLlmProviders = runtime.closeLlmProviders;
  port = runtime.port;

  await runtime.napcatGatewayService.start();
  await runtime.app.listen({ host: "0.0.0.0", port: runtime.port });
  isServerStarted = true;

  const providers = await runtime.listAvailableAgentProviders();

  logger.info("Server started", {
    event: "server.started",
    port: runtime.port,
    pid: process.pid,
    providers,
    listenGroupIds: runtime.listenGroupIds,
    hasTavilyApiKey: runtime.hasTavilyApiKey,
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
