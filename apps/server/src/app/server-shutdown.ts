import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.js";
import { closeDb as defaultCloseDb } from "../db/client.js";
import { AppLogger } from "../logger/logger.js";
import { getLoggerRuntime } from "../logger/runtime.js";
import type { NapcatGatewayService } from "../napcat/service/napcat-gateway.service.js";
import type { AuthUsageCacheManager } from "../auth/application/auth-usage-cache.impl.service.js";
import type { ClaudeCodeAuthRefreshScheduler } from "../auth/application/claude-code-auth-refresh.scheduler.js";
import type { IthomePoller } from "../news/application/ithome-poller.js";

export type AgentRuntimeController = {
  stop(): Promise<void>;
};

type ShutdownLogger = Pick<AppLogger, "info" | "warn" | "error" | "errorWithCause">;
type ShutdownTimeoutHandle = ReturnType<typeof setTimeout>;
type SetShutdownTimeout = (handler: () => void, timeoutMs: number) => ShutdownTimeoutHandle;
type ClearShutdownTimeout = (timeout: ShutdownTimeoutHandle) => void;

type ShutdownServerResourcesOptions = {
  signal: NodeJS.Signals;
  timeoutMs: number;
  isServerStarted: boolean;
  app: FastifyInstance | null;
  database: Database | null;
  napcatGatewayService: NapcatGatewayService | null;
  ithomePoller: IthomePoller | null;
  callbackServers: Array<{ stop(): Promise<void> }>;
  authUsageCacheManager: AuthUsageCacheManager | null;
  claudeCodeAuthRefreshScheduler: ClaudeCodeAuthRefreshScheduler | null;
  rootAgentRuntime: AgentRuntimeController | null;
  storyAgentRuntime: AgentRuntimeController | null;
  closeLlmProviders: (() => Promise<void>) | null;
  logger?: ShutdownLogger;
  closeLoggerRuntime?: () => Promise<void>;
  closeDatabase?: (database: Database) => Promise<void>;
  exit?: (code: number) => void;
  setShutdownTimeout?: SetShutdownTimeout;
  clearShutdownTimeout?: ClearShutdownTimeout;
};

const logger = new AppLogger({ source: "bootstrap" });

export async function shutdownServerResources({
  signal,
  timeoutMs,
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
  logger: shutdownLogger = logger,
  closeLoggerRuntime = async () => {
    await getLoggerRuntime().close();
  },
  closeDatabase = defaultCloseDb,
  exit = code => {
    process.exit(code);
  },
  setShutdownTimeout = setTimeout,
  clearShutdownTimeout = clearTimeout,
}: ShutdownServerResourcesOptions): Promise<void> {
  shutdownLogger.info("Shutdown signal received", {
    event: "server.shutdown.signal_received",
    signal,
  });

  const timeoutHandle = setShutdownTimeout(() => {
    shutdownLogger.error("Shutdown timed out", {
      event: "server.shutdown.timeout",
      timeoutMs,
    });
    exit(1);
  }, timeoutMs);

  try {
    if (isServerStarted && app) {
      await app.close();
      shutdownLogger.info("HTTP server closed", {
        event: "server.shutdown.http_closed",
      });
    }

    if (napcatGatewayService) {
      await napcatGatewayService.stop();
      shutdownLogger.info("Napcat gateway closed", {
        event: "server.shutdown.napcat_closed",
      });
    }

    if (ithomePoller) {
      ithomePoller.close();
      shutdownLogger.info("Ithome poller closed", {
        event: "server.shutdown.ithome_poller_closed",
      });
    }

    for (const callbackServer of callbackServers) {
      await callbackServer.stop();
    }

    if (authUsageCacheManager) {
      authUsageCacheManager.close();
      shutdownLogger.info("Auth usage cache manager closed", {
        event: "server.shutdown.auth_usage_cache_closed",
      });
    }

    if (claudeCodeAuthRefreshScheduler) {
      claudeCodeAuthRefreshScheduler.close();
      shutdownLogger.info("Claude Code auth refresh scheduler closed", {
        event: "server.shutdown.claude_code_auth_refresh_scheduler_closed",
      });
    }

    if (rootAgentRuntime) {
      await rootAgentRuntime.stop();
      shutdownLogger.info("Root agent runtime closed", {
        event: "server.shutdown.root_agent_runtime_closed",
      });
    }

    if (storyAgentRuntime) {
      await storyAgentRuntime.stop();
      shutdownLogger.info("Story agent runtime closed", {
        event: "server.shutdown.story_agent_runtime_closed",
      });
    }

    if (closeLlmProviders) {
      await closeLlmProviders();
      shutdownLogger.info("LLM providers closed", {
        event: "server.shutdown.llm_providers_closed",
      });
    }

    if (database) {
      shutdownLogger.info("Database client closing", {
        event: "server.shutdown.db_closing",
      });
    }

    await closeLoggerRuntime();

    if (database) {
      await closeDatabase(database);
    }

    clearShutdownTimeout(timeoutHandle);
    exit(0);
  } catch (error) {
    clearShutdownTimeout(timeoutHandle);
    shutdownLogger.errorWithCause("Shutdown failed", error, {
      event: "server.shutdown.failed",
      signal,
    });
    exit(1);
  }
}
