import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { AgentLoop } from "./agent/agent-loop.js";
import type { AgentContextManager } from "./agent/context-manager.manager.js";
import { DefaultAgentContextManager } from "./agent/context-manager.impl.manager.js";
import type { AgentEventQueue } from "./agent/event-queue.queue.js";
import { InMemoryAgentEventQueue } from "./agent/event-queue.impl.queue.js";
import { createAgentToolRegistry } from "./agent/tools/index.js";
import { env } from "./env.js";
import { closeDb, db } from "./db/client.js";
import { PrismaLlmChatCallDao } from "./dao/impl/llm-chat-call.impl.dao.js";
import { PrismaLogDao } from "./dao/impl/log.impl.dao.js";
import { PrismaNapcatEventDao } from "./dao/impl/napcat-event.impl.dao.js";
import { PrismaNapcatGroupMessageDao } from "./dao/impl/napcat-group-message.impl.dao.js";
import { AppLogHandler } from "./handler/app-log.handler.js";
import { HealthHandler } from "./handler/health.handler.js";
import { LlmHandler } from "./handler/llm.handler.js";
import { LlmChatCallHandler } from "./handler/llm-chat-call.handler.js";
import { NapcatEventHandler } from "./handler/napcat-event.handler.js";
import { NapcatGroupMessageHandler } from "./handler/napcat-group-message.handler.js";
import { NapcatHandler } from "./handler/napcat.handler.js";
import { createLlmClient } from "./llm/client.js";
import {
  LlmProviderResponseError,
  LlmProviderUnavailableError,
  LlmProviderUpstreamError,
} from "./llm/errors.js";
import { AppLogger } from "./logger/logger.js";
import { getLoggerRuntime, initLoggerRuntime, withTraceContext } from "./logger/runtime.js";
import { DbLogSink } from "./logger/sinks/db-sink.js";
import { StdoutLogSink } from "./logger/sinks/stdout-sink.js";
import type { AppLogQueryService } from "./service/app-log-query.service.js";
import { DefaultAppLogQueryService } from "./service/app-log-query.impl.service.js";
import type { LlmChatCallQueryService } from "./service/llm-chat-call-query.service.js";
import { DefaultLlmChatCallQueryService } from "./service/llm-chat-call-query.impl.service.js";
import type { LlmPlaygroundService } from "./service/llm-playground.service.js";
import { DefaultLlmPlaygroundService } from "./service/llm-playground.impl.service.js";
import type { NapcatEventQueryService } from "./service/napcat-event-query.service.js";
import { DefaultNapcatEventQueryService } from "./service/napcat-event-query.impl.service.js";
import type { NapcatGroupMessageQueryService } from "./service/napcat-group-message-query.service.js";
import { DefaultNapcatGroupMessageQueryService } from "./service/napcat-group-message-query.impl.service.js";
import type { NapcatGatewayService } from "./service/napcat-gateway.service.js";
import { NapcatGatewayError } from "./service/napcat-gateway.service.js";
import { DefaultNapcatGatewayService } from "./service/napcat-gateway.impl.service.js";
import { TavilyWebSearchService } from "./service/tavily-web-search.impl.service.js";

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
const napcatGroupMessageDao = new PrismaNapcatGroupMessageDao({ database: db });
const llmChatCallQueryService: LlmChatCallQueryService = new DefaultLlmChatCallQueryService({
  llmChatCallDao,
});
const appLogQueryService: AppLogQueryService = new DefaultAppLogQueryService({ logDao });
const napcatEventQueryService: NapcatEventQueryService = new DefaultNapcatEventQueryService({
  napcatEventDao,
});
const napcatGroupMessageQueryService: NapcatGroupMessageQueryService =
  new DefaultNapcatGroupMessageQueryService({
    napcatGroupMessageDao,
  });
const webSearchService = env.TAVILY_API_KEY
  ? new TavilyWebSearchService({
      apiKey: env.TAVILY_API_KEY,
    })
  : null;
const llmClient = createLlmClient({ llmChatCallDao });
const llmPlaygroundService: LlmPlaygroundService = new DefaultLlmPlaygroundService({ llmClient });
const contextManager: AgentContextManager = new DefaultAgentContextManager({});
const eventQueue: AgentEventQueue = new InMemoryAgentEventQueue();
const napcatGatewayService: NapcatGatewayService = new DefaultNapcatGatewayService({
  wsUrl: env.NAPCAT_WS_URL,
  reconnectMs: env.NAPCAT_WS_RECONNECT_MS,
  requestTimeoutMs: env.NAPCAT_WS_REQUEST_TIMEOUT_MS,
  listenGroupId: env.NAPCAT_LISTEN_GROUP_ID,
  onGroupMessage: event => {
    eventQueue.enqueue({
      type: "napcat_group_message",
      groupId: event.groupId,
      userId: event.userId,
      rawMessage: event.rawMessage,
      messageId: event.messageId,
      time: event.time,
    });
  },
  napcatEventDao,
  napcatGroupMessageDao,
});
const toolRegistry = createAgentToolRegistry({
  sendGroupMessage: ({ message }) => {
    return napcatGatewayService.sendGroupMessage({
      groupId: env.NAPCAT_LISTEN_GROUP_ID,
      message,
    });
  },
  searchWeb: input => {
    if (!webSearchService) {
      throw new Error("TAVILY_API_KEY 未配置，无法使用 search_web 工具");
    }

    return webSearchService.search(input);
  },
});
const agentLoop = new AgentLoop({
  llmClient,
  contextManager,
  eventQueue,
  toolRegistry,
});

const healthHandler = new HealthHandler();
const llmHandler = new LlmHandler({ llmPlaygroundService });
const llmChatCallHandler = new LlmChatCallHandler({ llmChatCallQueryService });
const appLogHandler = new AppLogHandler({ appLogQueryService });
const napcatEventHandler = new NapcatEventHandler({ napcatEventQueryService });
const napcatGroupMessageHandler = new NapcatGroupMessageHandler({ napcatGroupMessageQueryService });
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

  if (error instanceof LlmProviderUnavailableError) {
    logger.warn("Requested LLM provider is unavailable", {
      event: "http.request.llm_provider_unavailable",
      method: request.method,
      url: request.url,
      provider: error.provider,
    });

    return reply.code(400).send({
      code: "LLM_PROVIDER_UNAVAILABLE",
      message: "所选 LLM provider 当前不可用",
    });
  }

  if (error instanceof LlmProviderResponseError || error instanceof LlmProviderUpstreamError) {
    logger.errorWithCause("LLM upstream request failed", error, {
      event: "http.request.llm_upstream_error",
      method: request.method,
      url: request.url,
      provider: error.provider,
    });

    return reply.code(502).send({
      code: "LLM_UPSTREAM_ERROR",
      message: "LLM 上游服务调用失败",
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
  llmHandler,
  llmChatCallHandler,
  appLogHandler,
  napcatEventHandler,
  napcatGroupMessageHandler,
  napcatHandler,
]) {
  handler.register(app);
}

let isServerStarted = false;
let isShuttingDown = false;

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
    if (isServerStarted) {
      await app.close();
      logger.info("HTTP server closed", {
        event: "server.shutdown.http_closed",
      });
    }

    await napcatGatewayService.stop();
    logger.info("Napcat gateway closed", {
      event: "server.shutdown.napcat_closed",
    });

    await closeDb();
    logger.info("Database client closed", {
      event: "server.shutdown.db_closed",
    });

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

const port = env.PORT;

try {
  await napcatGatewayService.start();

  await app.listen({ port });
  isServerStarted = true;

  logger.info("Server started", {
    event: "server.started",
    port,
    pid: process.pid,
    providers: llmClient.listAvailableProviders(),
    listenGroupId: env.NAPCAT_LISTEN_GROUP_ID,
    hasTavilyApiKey: Boolean(env.TAVILY_API_KEY),
    traceRuntimeEnabled: getLoggerRuntime() !== null,
  });

  void agentLoop.run().catch(error => {
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

  await closeDb().catch(closeError => {
    logger.errorWithCause("Failed to close database client after startup failure", closeError, {
      event: "server.start_failed.db_close_failed",
    });
  });

  process.exit(1);
}
