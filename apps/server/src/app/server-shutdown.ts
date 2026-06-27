import type { FastifyInstance } from "fastify";
import type { Database } from "@kagami/server-core/db/client";
import { closeDb as defaultCloseDb } from "@kagami/server-core/db/client";
import { AppLogger } from "../logger/logger.js";
import { getLoggerRuntime } from "../logger/runtime.js";
import type { TaskScheduler } from "../scheduler/application/task-scheduler.js";

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
  /** 反序关停所有 App（含 QQ App 停 napcat 网关）。取代旧的 napcatGatewayService.stop。 */
  shutdownApps: (() => Promise<void>) | null;
  taskScheduler: TaskScheduler | null;
  callbackServers: Array<{ stop(): Promise<void> }>;
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
  shutdownApps,
  taskScheduler,
  callbackServers,
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

    if (shutdownApps) {
      await shutdownApps();
      shutdownLogger.info("Apps shut down (incl. Napcat gateway)", {
        event: "server.shutdown.apps_closed",
      });
    }

    if (taskScheduler) {
      await taskScheduler.stop();
      shutdownLogger.info("Task scheduler closed", {
        event: "server.shutdown.task_scheduler_closed",
      });
    }

    for (const callbackServer of callbackServers) {
      await callbackServer.stop();
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
