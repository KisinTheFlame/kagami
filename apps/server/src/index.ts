import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { AgentLoop } from "./agent/agent-loop.js";
import type { AgentContextManager } from "./agent/context-manager.manager.js";
import { DefaultAgentContextManager } from "./agent/context-manager.impl.manager.js";
import type { AgentEventQueue } from "./agent/event-queue.queue.js";
import { InMemoryAgentEventQueue } from "./agent/event-queue.impl.queue.js";
import { env } from "./env.js";
import { closeDb, db } from "./db/client.js";
import { PrismaLlmChatCallDao } from "./dao/impl/llm-chat-call.impl.dao.js";
import { PrismaLogDao } from "./dao/impl/log.impl.dao.js";
import { PrismaNapcatEventDao } from "./dao/impl/napcat-event.impl.dao.js";
import { AppLogHandler } from "./handler/app-log.handler.js";
import { HealthHandler } from "./handler/health.handler.js";
import { LlmChatCallHandler } from "./handler/llm-chat-call.handler.js";
import { NapcatEventHandler } from "./handler/napcat-event.handler.js";
import { NapcatHandler } from "./handler/napcat.handler.js";
import { createLlmClient } from "./llm/client.js";
import { AppLogger } from "./logger/logger.js";
import { getLoggerRuntime, initLoggerRuntime, withTraceContext } from "./logger/runtime.js";
import { DbLogSink } from "./logger/sinks/db-sink.js";
import { StdoutLogSink } from "./logger/sinks/stdout-sink.js";
import type { AppLogQueryService } from "./service/app-log-query.service.js";
import { DefaultAppLogQueryService } from "./service/app-log-query.impl.service.js";
import type { LlmChatCallQueryService } from "./service/llm-chat-call-query.service.js";
import { DefaultLlmChatCallQueryService } from "./service/llm-chat-call-query.impl.service.js";
import type { NapcatEventQueryService } from "./service/napcat-event-query.service.js";
import { DefaultNapcatEventQueryService } from "./service/napcat-event-query.impl.service.js";
import type { NapcatGatewayService } from "./service/napcat-gateway.service.js";
import { NapcatGatewayError } from "./service/napcat-gateway.service.js";
import { DefaultNapcatGatewayService } from "./service/napcat-gateway.impl.service.js";

const app = Fastify({ logger: false, disableRequestLogging: true });
const SHUTDOWN_TIMEOUT_MS = 10_000;
const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";

const logDao = new PrismaLogDao({ database: db });
initLoggerRuntime({
  sinks: [new StdoutLogSink(), new DbLogSink({ logDao })],
});

const logger = new AppLogger({ source: "bootstrap" });

const llmChatCallDao = new PrismaLlmChatCallDao({ database: db });
const napcatEventDao = new PrismaNapcatEventDao({ database: db });
const llmChatCallQueryService: LlmChatCallQueryService = new DefaultLlmChatCallQueryService({
  llmChatCallDao,
});
const appLogQueryService: AppLogQueryService = new DefaultAppLogQueryService({ logDao });
const napcatEventQueryService: NapcatEventQueryService = new DefaultNapcatEventQueryService({
  napcatEventDao,
});
const llmClient = createLlmClient({ llmChatCallDao });
const contextManager: AgentContextManager = new DefaultAgentContextManager({});
const eventQueue: AgentEventQueue = new InMemoryAgentEventQueue();
const agentLoop = new AgentLoop({ llmClient, contextManager, eventQueue });
const napcatGatewayService: NapcatGatewayService = new DefaultNapcatGatewayService({
  wsUrl: env.NAPCAT_WS_URL,
  reconnectMs: env.NAPCAT_WS_RECONNECT_MS,
  requestTimeoutMs: env.NAPCAT_WS_REQUEST_TIMEOUT_MS,
  napcatEventDao,
});

const healthHandler = new HealthHandler();
const llmChatCallHandler = new LlmChatCallHandler({ llmChatCallQueryService });
const appLogHandler = new AppLogHandler({ appLogQueryService });
const napcatEventHandler = new NapcatEventHandler({ napcatEventQueryService });
const napcatHandler = new NapcatHandler({ napcatGatewayService });

app.addHook("onRequest", (_request, reply, done) => {
  const traceId = randomUUID();
  reply.header(TRACE_ID_HEADER_NAME, traceId);

  withTraceContext(traceId, () => {
    done();
  });
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) {
    logger.warn("Request validation failed", {
      event: "http.request.validation_failed",
      method: request.method,
      url: request.url,
      issues: error.issues,
    });

    return reply.code(400).send({
      code: "BAD_REQUEST",
      message: "请求参数不合法",
    });
  }

  if (error instanceof NapcatGatewayError) {
    logger.errorWithCause("NapCat upstream request failed", error, {
      event: "http.request.napcat_upstream_error",
      method: request.method,
      url: request.url,
    });

    return reply.code(502).send({
      code: "NAPCAT_UPSTREAM_ERROR",
      message: "NapCat 上游服务不可用",
    });
  }

  logger.errorWithCause("Unhandled request error", error, {
    event: "http.request.unhandled_error",
    method: request.method,
    url: request.url,
  });

  return reply.code(500).send({
    code: "INTERNAL_SERVER_ERROR",
    message: "服务器内部错误",
  });
});

for (const handler of [
  healthHandler,
  llmChatCallHandler,
  appLogHandler,
  napcatEventHandler,
  napcatHandler,
]) {
  handler.register(app);
}

let isServerStarted = false;
let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    logger.warn("Shutdown already in progress", { signal });
    return;
  }

  isShuttingDown = true;
  logger.info("Received shutdown signal, starting graceful shutdown", { signal });

  const forceExitTimer = setTimeout(() => {
    logger.error("Graceful shutdown timeout, forcing exit", {
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  let exitCode = 0;

  if (isServerStarted) {
    try {
      await app.close();
      logger.info("Fastify server closed");
    } catch (error) {
      exitCode = 1;
      logger.error("Failed to close Fastify server", { error });
    }
  }

  try {
    await napcatGatewayService.stop();
    logger.info("NapCat gateway stopped");
  } catch (error) {
    exitCode = 1;
    logger.error("Failed to stop NapCat gateway", { error });
  }

  try {
    await getLoggerRuntime().close();
  } catch (error) {
    exitCode = 1;
    writeProcessError("Failed to close logger runtime", error);
  }

  try {
    await closeDb();
  } catch (error) {
    exitCode = 1;
    writeProcessError("Failed to close database connection", error);
  }

  clearTimeout(forceExitTimer);
  process.exit(exitCode);
}

function registerShutdownSignals(): void {
  const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

  for (const signal of shutdownSignals) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
}

async function start() {
  registerShutdownSignals();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.PORT,
    });
    isServerStarted = true;

    void napcatGatewayService.start().catch(error => {
      logger.error("Failed to start NapCat gateway", { error });
    });

    void agentLoop
      .run()
      .then(() => {
        logger.fatal("Agent loop exited unexpectedly");
        void shutdown("SIGTERM");
      })
      .catch(error => {
        logger.fatal("Agent loop failed", { error });
        void shutdown("SIGTERM");
      });
  } catch (error) {
    logger.error("Failed to start server", { error });

    try {
      await getLoggerRuntime().close();
    } catch (closeLoggerError) {
      writeProcessError("Failed to close logger runtime after startup failure", closeLoggerError);
    }

    try {
      await closeDb();
    } catch (closeError) {
      writeProcessError("Failed to close database after startup failure", closeError);
    }

    process.exit(1);
  }
}

void start();

function writeProcessError(message: string, error: unknown): void {
  const payload = {
    message,
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
  };

  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
