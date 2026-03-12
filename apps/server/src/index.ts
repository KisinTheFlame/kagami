import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { AgentLoop } from "./agent/agent-loop.js";
import { InMemoryAgentEventQueue } from "./agent/event.impl.queue.js";
import { DefaultConfigManager } from "./config/config.impl.manager.js";
import { loadStaticConfig } from "./config/config.loader.js";
import { DefaultAgentContext } from "./context/default-agent-context.js";
import { createAgentSystemPrompt } from "./context/system-prompt.js";
import { closeDb, createDbClient, type Database } from "./db/client.js";
import { PrismaLlmChatCallDao } from "./dao/impl/llm-chat-call.impl.dao.js";
import { PrismaLogDao } from "./dao/impl/log.impl.dao.js";
import { PrismaNapcatEventDao } from "./dao/impl/napcat-event.impl.dao.js";
import { PrismaNapcatGroupMessageChunkDao } from "./dao/impl/napcat-group-message-chunk.impl.dao.js";
import { PrismaNapcatGroupMessageDao } from "./dao/impl/napcat-group-message.impl.dao.js";
import { BizError } from "./errors/biz-error.js";
import { toHttpErrorResponse } from "./errors/http-error.js";
import { AppLogHandler } from "./handler/app-log.handler.js";
import { HealthHandler } from "./handler/health.handler.js";
import { LlmHandler } from "./handler/llm.handler.js";
import { LlmChatCallHandler } from "./handler/llm-chat-call.handler.js";
import { NapcatEventHandler } from "./handler/napcat-event.handler.js";
import { NapcatGroupMessageHandler } from "./handler/napcat-group-message.handler.js";
import { NapcatHandler } from "./handler/napcat.handler.js";
import { createLlmClient } from "./llm/client.js";
import { createEmbeddingClient } from "./llm/embedding/client.js";
import { createDeepSeekProvider } from "./llm/providers/deepseek-provider.js";
import { createOpenAiCodexProvider } from "./llm/providers/openai-codex-provider.js";
import { createOpenAiProvider } from "./llm/providers/openai-provider.js";
import { AppLogger } from "./logger/logger.js";
import { getLoggerRuntime, initLoggerRuntime, withTraceContext } from "./logger/runtime.js";
import { GroupMessageChunkIndexer } from "./rag/indexer.service.js";
import { GroupMessageMemorySearchService } from "./rag/memory-search.service.js";
import { RagContextEventEnricher } from "./rag/rag-context-event-enricher.js";
import { RagQueryPlannerService } from "./rag/rag-query-planner.service.js";
import { DbLogSink } from "./logger/sinks/db-sink.js";
import { StdoutLogSink } from "./logger/sinks/stdout-sink.js";
import { DefaultAppLogQueryService } from "./service/app-log-query.impl.service.js";
import { DefaultLlmChatCallQueryService } from "./service/llm-chat-call-query.impl.service.js";
import { DefaultLlmPlaygroundService } from "./service/llm-playground.impl.service.js";
import { DefaultAgentMessageService } from "./service/agent-message.impl.service.js";
import { DefaultNapcatEventQueryService } from "./service/napcat-event-query.impl.service.js";
import { NapcatEventPersistenceWriter } from "./service/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatGatewayService } from "./service/napcat-gateway.impl.service.js";
import type { NapcatGatewayService } from "./service/napcat-gateway.service.js";
import { DefaultNapcatGroupMessageQueryService } from "./service/napcat-group-message-query.impl.service.js";
import { TavilyWebSearchService } from "./service/tavily-web-search.impl.service.js";
import {
  FINISH_TOOL_NAME,
  FinishTool,
  SEARCH_MEMORY_TOOL_NAME,
  SEARCH_WEB_TOOL_NAME,
  SearchMemoryTool,
  SEND_GROUP_MESSAGE_TOOL_NAME,
  SearchWebTool,
  SendGroupMessageTool,
  ToolCatalog,
} from "./tools/index.js";

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
  const staticConfig = await loadStaticConfig();
  const activeConfigManager = new DefaultConfigManager({
    config: staticConfig,
  });

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
  const napcatGroupMessageChunkDao = new PrismaNapcatGroupMessageChunkDao({
    database: databaseClient,
  });
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
  const llmConfig = await activeConfigManager.getLlmRuntimeConfig();
  const llmProviders = {
    deepseek: llmConfig.deepseek.apiKey
      ? createDeepSeekProvider({
          ...llmConfig.deepseek,
          apiKey: llmConfig.deepseek.apiKey,
        })
      : undefined,
    openai: llmConfig.openai.apiKey
      ? createOpenAiProvider({
          ...llmConfig.openai,
          apiKey: llmConfig.openai.apiKey,
        })
      : undefined,
    "openai-codex": createOpenAiCodexProvider(llmConfig.openaiCodex),
  };
  const llmClient = createLlmClient({
    llmChatCallDao,
    providers: llmProviders,
    providerConfigs: {
      deepseek: llmConfig.deepseek,
      openai: llmConfig.openai,
      "openai-codex": llmConfig.openaiCodex,
    },
    usages: llmConfig.usages,
  });
  const ragConfig = await activeConfigManager.getRagRuntimeConfig();
  const embeddingClient = createEmbeddingClient({
    config: ragConfig.embedding,
  });
  const groupMessageChunkIndexer = new GroupMessageChunkIndexer({
    chunkDao: napcatGroupMessageChunkDao,
    embeddingClient,
    outputDimensionality: ragConfig.embedding.outputDimensionality,
  });
  const memorySearchService = new GroupMessageMemorySearchService({
    config: ragConfig,
    embeddingClient,
    chunkDao: napcatGroupMessageChunkDao,
    groupMessageDao: napcatGroupMessageDao,
  });
  const agentSystemPromptFactory = async () => {
    const botProfile = await activeConfigManager.getBotProfileConfig();
    return createAgentSystemPrompt({
      botQQ: botProfile.botQQ,
    });
  };
  const tavilyConfig = await activeConfigManager.getTavilyConfig();
  const webSearchService = new TavilyWebSearchService({
    apiKey: tavilyConfig.apiKey,
  });
  const eventQueue = new InMemoryAgentEventQueue();
  const napcatPersistenceWriter = new NapcatEventPersistenceWriter({
    napcatEventDao,
    napcatGroupMessageDao,
    napcatGroupMessageChunkDao,
    groupMessageChunkIndexer,
  });

  const activeNapcatGatewayService: NapcatGatewayService = await DefaultNapcatGatewayService.create(
    {
      configManager: activeConfigManager,
      eventQueue,
      persistenceWriter: napcatPersistenceWriter,
    },
  );
  napcatGatewayService = activeNapcatGatewayService;

  const agentMessageService = new DefaultAgentMessageService({
    napcatGatewayService: activeNapcatGatewayService,
    targetGroupId: bootConfig.napcat.listenGroupId,
  });
  const toolCatalog = new ToolCatalog([
    new SearchWebTool({
      webSearchService,
    }),
    new SendGroupMessageTool({
      agentMessageService,
    }),
    new FinishTool(),
    new SearchMemoryTool({
      memorySearchService,
    }),
  ]);
  const ragQueryPlanner = new RagQueryPlannerService({
    llmClient,
    plannerTools: toolCatalog.pick([SEARCH_MEMORY_TOOL_NAME]),
    systemPromptFactory: agentSystemPromptFactory,
  });
  const llmPlaygroundService = new DefaultLlmPlaygroundService({ llmClient });
  const ragContextEventEnricher = new RagContextEventEnricher({
    ragQueryPlanner,
  });
  const context = new DefaultAgentContext({
    systemPromptFactory: agentSystemPromptFactory,
    eventEnricher: ragContextEventEnricher,
  });
  const agentTools = toolCatalog.pick([
    SEARCH_WEB_TOOL_NAME,
    SEND_GROUP_MESSAGE_TOOL_NAME,
    FINISH_TOOL_NAME,
  ]);
  const agentLoop = new AgentLoop({
    llmClient,
    context,
    eventQueue,
    agentTools,
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
        message: "请求参数不合法",
      });
    }

    if (error instanceof BizError) {
      logger.errorWithCause("Handled business request error", error, {
        event: "http.request.biz_error",
        method: request.method,
        url: request.url,
        ...(error.meta ?? {}),
      });

      const response = toHttpErrorResponse(error);
      return reply.code(response.statusCode).send(response.body);
    }

    logger.errorWithCause("Unhandled request error", error, {
      event: "http.request.unhandled_error",
      method: request.method,
      url: request.url,
    });

    return reply.code(500).send({
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

  const providers = await llmClient.listAvailableProviders({ usage: "agent" });

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

  process.exit(1);
}
