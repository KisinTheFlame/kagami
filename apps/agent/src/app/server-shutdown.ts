import type { FastifyInstance } from "fastify";
import type { Database } from "@kagami/persistence/db/client";
import { closeDb as defaultCloseDb } from "@kagami/persistence/db/client";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { getLoggerRuntime } from "@kagami/kernel/logger/runtime";
import type { SchedulerClient } from "@kagami/scheduler-client/scheduler-client";

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
  schedulerClient: SchedulerClient | null;
  callbackServers: Array<{ stop(): Promise<void> }>;
  rootAgentRuntime: AgentRuntimeController | null;
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
  schedulerClient,
  callbackServers,
  rootAgentRuntime,
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

  // 每个资源的关停都 best-effort 兜住：单步抛错**不**跳过后续步骤（尤其 DB 关闭必须执行，否则
  // SQLite 连接泄漏 / WAL 不 checkpoint）。收集所有失败，最后据此决定 exit code。
  const errors: unknown[] = [];
  const step = async (
    label: string,
    event: string,
    run: () => void | Promise<void>,
  ): Promise<void> => {
    try {
      await run();
      shutdownLogger.info(label, { event });
    } catch (error) {
      errors.push(error);
      shutdownLogger.errorWithCause(`${label} failed`, error, {
        event: `${event}.failed`,
        signal,
      });
    }
  };

  if (isServerStarted && app) {
    await step("HTTP server closed", "server.shutdown.http_closed", () => app.close());
  }
  if (shutdownApps) {
    await step(
      "Apps shut down (incl. Napcat gateway)",
      "server.shutdown.apps_closed",
      shutdownApps,
    );
  }
  if (schedulerClient) {
    // 拆分后调度器在独立进程；本地只停 SDK 的订阅循环 + 中断在跑的 handler（同步，无需 await）。
    await step("Scheduler client closed", "server.shutdown.scheduler_client_closed", () =>
      schedulerClient.stop(),
    );
  }
  for (const callbackServer of callbackServers) {
    await step("Callback server closed", "server.shutdown.callback_server_closed", () =>
      callbackServer.stop(),
    );
  }
  if (rootAgentRuntime) {
    await step("Root agent runtime closed", "server.shutdown.root_agent_runtime_closed", () =>
      rootAgentRuntime.stop(),
    );
  }
  if (closeLlmProviders) {
    await step("LLM providers closed", "server.shutdown.llm_providers_closed", closeLlmProviders);
  }
  // logger runtime 与 DB 放最后关：前面各步都可能还要写日志。DB 关闭无条件执行（在 errors 里也照关）。
  await step("Logger runtime closed", "server.shutdown.logger_closed", closeLoggerRuntime);
  if (database) {
    await step("Database client closed", "server.shutdown.db_closed", () =>
      closeDatabase(database),
    );
  }

  clearShutdownTimeout(timeoutHandle);
  if (errors.length > 0) {
    exit(1);
    return;
  }
  exit(0);
}
