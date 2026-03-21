import { getLoggerRuntime, initLoggerRuntime } from "./logger/runtime.js";
import { closeDb, type Database } from "./db/client.js";
import { AppLogger } from "./logger/logger.js";
import { StdoutLogSink } from "./logger/sinks/stdout-sink.js";
import { buildServerRuntime } from "./bootstrap/server-runtime.js";
import type { FastifyInstance } from "fastify";
import type { NapcatGatewayService } from "./service/napcat-gateway.service.js";
import { ClaudeCodeAuthCallbackServer } from "./claude-code-auth/callback-server.js";
import { CodexAuthCallbackServer } from "./codex-auth/callback-server.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

initLoggerRuntime({
  sinks: [new StdoutLogSink()],
});

const logger = new AppLogger({ source: "bootstrap" });

let app: FastifyInstance | null = null;
let database: Database | null = null;
let napcatGatewayService: NapcatGatewayService | null = null;
let claudeCodeAuthCallbackServer: ClaudeCodeAuthCallbackServer | null = null;
let codexAuthCallbackServer: CodexAuthCallbackServer | null = null;
let isServerStarted = false;
let isShuttingDown = false;
let port: number | null = null;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    logger.warn("Shutdown already in progress, ignoring repeated signal", {
      event: "server.shutdown.signal_ignored",
      signal,
    });
    return;
  }

  isShuttingDown = true;

  logger.info("Shutdown signal received", {
    event: "server.shutdown.signal_received",
    signal,
  });

  const timeoutHandle = setTimeout(() => {
    logger.error("Shutdown timed out", {
      event: "server.shutdown.timeout",
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    if (isServerStarted && app) {
      await app.close();
      logger.info("HTTP server closed", {
        event: "server.shutdown.http_closed",
      });
    }

    if (napcatGatewayService) {
      await napcatGatewayService.stop();
      logger.info("Napcat gateway closed", {
        event: "server.shutdown.napcat_closed",
      });
    }

    if (claudeCodeAuthCallbackServer) {
      await claudeCodeAuthCallbackServer.stop();
      logger.info("Claude Code auth callback server closed", {
        event: "server.shutdown.claude_code_auth_callback_closed",
      });
    }

    if (codexAuthCallbackServer) {
      await codexAuthCallbackServer.stop();
      logger.info("Codex auth callback server closed", {
        event: "server.shutdown.codex_auth_callback_closed",
      });
    }

    if (database) {
      logger.info("Database client closing", {
        event: "server.shutdown.db_closing",
      });
    }

    await getLoggerRuntime().close();

    if (database) {
      await closeDb(database);
    }

    clearTimeout(timeoutHandle);
    process.exit(0);
  } catch (error) {
    clearTimeout(timeoutHandle);
    logger.errorWithCause("Shutdown failed", error, {
      event: "server.shutdown.failed",
      signal,
    });
    process.exit(1);
  }
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
  claudeCodeAuthCallbackServer = runtime.claudeCodeAuthCallbackServer;
  codexAuthCallbackServer = runtime.codexAuthCallbackServer;
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
    listenGroupId: runtime.listenGroupId,
    hasTavilyApiKey: runtime.hasTavilyApiKey,
    traceRuntimeEnabled: true,
  });

  void runtime.agentLoop.run().catch(error => {
    logger.errorWithCause("Agent loop crashed", error, {
      event: "agent.loop.crashed",
    });
    void shutdown("SIGTERM");
  });
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
