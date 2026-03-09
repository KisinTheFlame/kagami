import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { closeGaiaClient, initializeGaiaClient } from "@kisinwen/gaia-client";
import { z } from "zod";
import { AgentLoop } from "./agent/agent-loop.js";
import { DefaultAgentContextManager } from "./agent/context-manager.impl.manager.js";
import { createAgentSystemPrompt } from "./agent/context.js";
import { InMemoryAgentEventQueue } from "./agent/event-queue.impl.queue.js";
import { createAgentToolRegistry } from "./agent/tools/index.js";
import { ConfigManagerError, DefaultConfigManager } from "./config/config.impl.manager.js";
import { closeDb, createDbClient, type Database } from "./db/client.js";
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
import { DefaultAppLogQueryService } from "./service/app-log-query.impl.service.js";
import { DefaultLlmChatCallQueryService } from "./service/llm-chat-call-query.impl.service.js";
import { DefaultLlmPlaygroundService } from "./service/llm-playground.impl.service.js";
import { DefaultNapcatEventQueryService } from "./service/napcat-event-query.impl.service.js";
import { DefaultNapcatGatewayService } from "./service/napcat-gateway.impl.service.js";
import { NapcatGatewayError, type NapcatGatewayService } from "./service/napcat-gateway.service.js";
import { DefaultNapcatGroupMessageQueryService } from "./service/napcat-group-message-query.impl.service.js";
import { TavilyWebSearchService } from "./service/tavily-web-search.impl.service.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";

initLoggerRuntime({
  sinks: [new StdoutLogSink()],
});

const logger = new AppLogger({ source: "bootstrap" });

let app: FastifyInstance | null = null;
let database: Database | null = null;
let napcatGatewayService: NapcatGatewayService | null = null;
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

    if (database) {
      logger.info("Database client closing", {
        event: "server.shutdown.db_closing",
      });
    }

    await getLoggerRuntime().close();

    if (database) {
      await closeDb(database);
    }
    await closeGaiaClient();

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
  await initializeGaiaClient();
  const activeConfigManager = new DefaultConfigManager({});

  const bootConfig = await activeConfigManager.getBootConfig();
  port = bootConfig.port;
  const databaseClient = createDbClient({
    databaseUrl: bootConfig.databaseUrl,
  });
  database = databaseClient;

  const logDao = new PrismaLogDao({ database: databaseClient });
  initLoggerRuntime({
    sinks: [new StdoutLogSink(), new DbLogSink({ logDao })],
  });

  const llmChatCallDao = new PrismaLlmChatCallDao({ database: databaseClient });
  const napcatEventDao = new PrismaNapcatEventDao({ database: databaseClient });
  const napcatGroupMessageDao = new PrismaNapcatGroupMessageDao({ database: databaseClient });
  const llmChatCallQueryService = new DefaultLlmChatCallQueryService({
    llmChatCallDao,
  });
  const appLogQueryService = new DefaultAppLogQueryService({ logDao });
  const napcatEventQueryService = new DefaultNapcatEventQueryService({
    napcatEventDao,
  });
  const napcatGroupMessageQueryService = new DefaultNapcatGroupMessageQueryService({
    napcatGroupMessageDao,
  });
  const llmClient = createLlmClient({
    configManager: activeConfigManager,
    llmChatCallDao,
  });
  const llmPlaygroundService = new DefaultLlmPlaygroundService({ llmClient });
  const eventQueue = new InMemoryAgentEventQueue();
  const contextManager = new DefaultAgentContextManager({
    systemPromptFactory: async () => {
      const botProfile = await activeConfigManager.getBotProfileConfig();
      return createAgentSystemPrompt({
        botQQ: botProfile.botQQ,
      });
    },
  });

  const activeNapcatGatewayService: NapcatGatewayService = new DefaultNapcatGatewayService({
    wsUrl: bootConfig.napcat.wsUrl,
    reconnectMs: bootConfig.napcat.reconnectMs,
    requestTimeoutMs: bootConfig.napcat.requestTimeoutMs,
    listenGroupId: bootConfig.napcat.listenGroupId,
    onGroupMessage: event => {
      eventQueue.enqueue({
        type: "napcat_group_message",
        groupId: event.groupId,
        userId: event.userId,
        nickname: event.nickname,
        rawMessage: event.rawMessage,
        messageId: event.messageId,
        time: event.time,
      });
    },
    napcatEventDao,
    napcatGroupMessageDao,
  });
  napcatGatewayService = activeNapcatGatewayService;

  const toolRegistry = createAgentToolRegistry({
    sendGroupMessage: ({ message }) => {
      return activeNapcatGatewayService.sendGroupMessage({
        groupId: bootConfig.napcat.listenGroupId,
        message,
      });
    },
    searchWeb: async input => {
      const tavilyConfig = await activeConfigManager.getTavilyConfig();
      if (!tavilyConfig.apiKey) {
        throw new Error("kagami.tavily.api-key 未配置，无法使用 search_web 工具");
      }

      return new TavilyWebSearchService({
        apiKey: tavilyConfig.apiKey,
      }).search(input);
    },
  });
  const agentLoop = new AgentLoop({
    llmClient,
    contextManager,
    eventQueue,
    toolRegistry,
  });

  const serverApp = Fastify({ logger: false, disableRequestLogging: true });
  app = serverApp;

  serverApp.addHook("onRequest", (_request, reply, done) => {
    const traceId = randomUUID();
    reply.header(TRACE_ID_HEADER_NAME, traceId);

    withTraceContext(traceId, () => {
      done();
    });
  });

  serverApp.setErrorHandler((error, request, reply) => {
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

    if (error instanceof ConfigManagerError) {
      logger.errorWithCause("Runtime config access failed", error, {
        event: "http.request.config_error",
        method: request.method,
        url: request.url,
        configKey: error.key,
        configErrorCode: error.code,
      });

      return reply.code(500).send({
        code: "CONFIG_ERROR",
        message: "运行时配置读取失败",
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
    new HealthHandler(),
    new LlmHandler({ llmPlaygroundService }),
    new LlmChatCallHandler({ llmChatCallQueryService }),
    new AppLogHandler({ appLogQueryService }),
    new NapcatEventHandler({ napcatEventQueryService }),
    new NapcatGroupMessageHandler({ napcatGroupMessageQueryService }),
    new NapcatHandler({ napcatGatewayService }),
  ]) {
    handler.register(serverApp);
  }

  await activeNapcatGatewayService.start();
  await serverApp.listen({ host: "0.0.0.0", port: bootConfig.port });
  isServerStarted = true;

  const providers = await llmClient.listAvailableProviders();
  const tavilyConfig = await activeConfigManager.getTavilyConfig();

  logger.info("Server started", {
    event: "server.started",
    port: bootConfig.port,
    pid: process.pid,
    providers,
    listenGroupId: bootConfig.napcat.listenGroupId,
    hasTavilyApiKey: Boolean(tavilyConfig.apiKey),
    traceRuntimeEnabled: true,
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

  if (database) {
    await closeDb(database).catch(closeError => {
      logger.errorWithCause("Failed to close database client after startup failure", closeError, {
        event: "server.start_failed.db_close_failed",
      });
    });
  }

  await closeGaiaClient().catch(() => undefined);
  process.exit(1);
}
