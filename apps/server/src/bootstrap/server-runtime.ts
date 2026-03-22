import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { AgentLoop, createAgentSystemPrompt } from "../agents/main-engine/index.js";
import { ContextSummaryPlannerService } from "../agents/subagents/context-summarizer/index.js";
import {
  ReplyThoughtTool,
  ReviewReplyStrategyTool,
  TrySendMessageService,
  WriteReplyMessageTool,
} from "../agents/subagents/reply-sender/index.js";
import {
  createRagSystemPrompt,
  RagContextEventEnricher,
  RagQueryPlannerService,
} from "../agents/subagents/rag/index.js";
import { VisionAgent } from "../agents/subagents/vision/index.js";
import { DefaultConfigManager } from "../config/config.impl.manager.js";
import { loadStaticConfig } from "../config/config.loader.js";
import { ClaudeCodeAuthCallbackServer } from "../claude-code-auth/callback-server.js";
import { DefaultAgentContext } from "../context/default-agent-context.js";
import { CodexAuthCallbackServer } from "../codex-auth/callback-server.js";
import { createDbClient, type Database } from "../db/client.js";
import { PrismaClaudeCodeAuthDao } from "../dao/impl/claude-code-auth.impl.dao.js";
import { PrismaCodexAuthDao } from "../dao/impl/codex-auth.impl.dao.js";
import { PrismaEmbeddingCacheDao } from "../dao/impl/embedding-cache.impl.dao.js";
import { PrismaLlmChatCallDao } from "../dao/impl/llm-chat-call.impl.dao.js";
import { PrismaLogDao } from "../dao/impl/log.impl.dao.js";
import { PrismaNapcatEventDao } from "../dao/impl/napcat-event.impl.dao.js";
import { PrismaNapcatGroupMessageChunkDao } from "../dao/impl/napcat-group-message-chunk.impl.dao.js";
import { PrismaNapcatGroupMessageDao } from "../dao/impl/napcat-group-message.impl.dao.js";
import { BizError } from "../errors/biz-error.js";
import { toHttpErrorResponse } from "../errors/http-error.js";
import { AppLogHandler } from "../handler/app-log.handler.js";
import { ClaudeCodeAuthHandler } from "../handler/claude-code-auth.handler.js";
import { CodexAuthHandler } from "../handler/codex-auth.handler.js";
import { EmbeddingCacheHandler } from "../handler/embedding-cache.handler.js";
import { HealthHandler } from "../handler/health.handler.js";
import { LlmHandler } from "../handler/llm.handler.js";
import { LlmChatCallHandler } from "../handler/llm-chat-call.handler.js";
import { NapcatEventHandler } from "../handler/napcat-event.handler.js";
import { NapcatGroupMessageHandler } from "../handler/napcat-group-message.handler.js";
import { NapcatHandler } from "../handler/napcat.handler.js";
import { createLlmClient } from "../llm/client.js";
import { createEmbeddingClient } from "../llm/embedding/client.js";
import { createDeepSeekProvider } from "../llm/providers/deepseek-provider.js";
import { ClaudeCodeAuthStore } from "../llm/providers/claude-code-auth.js";
import { createClaudeCodeProvider } from "../llm/providers/claude-code-provider.js";
import { OpenAiCodexAuthStore } from "../llm/providers/openai-codex-auth.js";
import { createOpenAiCodexProvider } from "../llm/providers/openai-codex-provider.js";
import { createOpenAiProvider } from "../llm/providers/openai-provider.js";
import { AppLogger } from "../logger/logger.js";
import { initLoggerRuntime, withTraceContext } from "../logger/runtime.js";
import { DbLogSink } from "../logger/sinks/db-sink.js";
import { StdoutLogSink } from "../logger/sinks/stdout-sink.js";
import { InMemoryAgentEventQueue } from "../event/event.impl.queue.js";
import { GroupMessageChunkIndexer } from "../rag/indexer.service.js";
import { GroupMessageMemorySearchService } from "../rag/memory-search.service.js";
import { DefaultAgentMessageService } from "../service/agent-message.impl.service.js";
import { DefaultAppLogQueryService } from "../service/app-log-query.impl.service.js";
import { DefaultClaudeCodeAuthService } from "../service/claude-code-auth.impl.service.js";
import { DefaultCodexAuthService } from "../service/codex-auth.impl.service.js";
import { DefaultEmbeddingCacheQueryService } from "../service/embedding-cache-query.impl.service.js";
import { DefaultLlmChatCallQueryService } from "../service/llm-chat-call-query.impl.service.js";
import { DefaultLlmPlaygroundService } from "../service/llm-playground.impl.service.js";
import { NapcatEventPersistenceWriter } from "../service/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatImageMessageAnalyzer } from "../service/napcat-gateway/image-message-analyzer.js";
import { DefaultNapcatGatewayService } from "../service/napcat-gateway.impl.service.js";
import type { NapcatGatewayService } from "../service/napcat-gateway.service.js";
import { DefaultNapcatEventQueryService } from "../service/napcat-event-query.impl.service.js";
import { DefaultNapcatGroupMessageQueryService } from "../service/napcat-group-message-query.impl.service.js";
import { TavilyWebSearchService } from "../service/tavily-web-search.impl.service.js";
import {
  FINISH_TOOL_NAME,
  FinishTool,
  SEARCH_MEMORY_TOOL_NAME,
  SEARCH_WEB_TOOL_NAME,
  SEND_GROUP_MESSAGE_TOOL_NAME,
  SearchMemoryTool,
  SearchWebTool,
  SendGroupMessageTool,
  SUMMARY_TOOL_NAME,
  SummaryTool,
  ToolCatalog,
  TRY_SEND_MESSAGE_TOOL_NAME,
  TrySendMessageTool,
} from "../tools/index.js";

const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";
const logger = new AppLogger({ source: "bootstrap" });

type AppRouteHandler = {
  register(app: FastifyInstance): void;
};

export type ServerRuntime = {
  app: FastifyInstance;
  database: Database;
  napcatGatewayService: NapcatGatewayService;
  claudeCodeAuthCallbackServer: ClaudeCodeAuthCallbackServer;
  codexAuthCallbackServer: CodexAuthCallbackServer;
  agentLoop: AgentLoop;
  port: number;
  listenGroupId: string;
  hasTavilyApiKey: boolean;
  listAvailableAgentProviders: () => Promise<
    Awaited<ReturnType<ReturnType<typeof createLlmClient>["listAvailableProviders"]>>
  >;
};

export async function buildServerRuntime(): Promise<ServerRuntime> {
  const staticConfig = await loadStaticConfig();
  const configManager = new DefaultConfigManager({
    config: staticConfig,
  });

  const bootConfig = await configManager.getBootConfig();
  const database = createDbClient({
    databaseUrl: bootConfig.databaseUrl,
  });

  const logDao = new PrismaLogDao({ database });
  initLoggerRuntime({
    sinks: [new StdoutLogSink(), new DbLogSink({ logDao })],
  });

  const llmChatCallDao = new PrismaLlmChatCallDao({ database });
  const claudeCodeAuthDao = new PrismaClaudeCodeAuthDao({ database });
  const codexAuthDao = new PrismaCodexAuthDao({ database });
  const embeddingCacheDao = new PrismaEmbeddingCacheDao({ database });
  const napcatEventDao = new PrismaNapcatEventDao({ database });
  const napcatGroupMessageDao = new PrismaNapcatGroupMessageDao({ database });
  const napcatGroupMessageChunkDao = new PrismaNapcatGroupMessageChunkDao({
    database,
  });
  const llmChatCallQueryService = new DefaultLlmChatCallQueryService({
    llmChatCallDao,
  });
  const embeddingCacheQueryService = new DefaultEmbeddingCacheQueryService({
    embeddingCacheDao,
  });
  const appLogQueryService = new DefaultAppLogQueryService({ logDao });
  const napcatEventQueryService = new DefaultNapcatEventQueryService({
    napcatEventDao,
  });
  const napcatGroupMessageQueryService = new DefaultNapcatGroupMessageQueryService({
    napcatGroupMessageDao,
  });

  const claudeCodeAuthConfig = await configManager.getClaudeCodeAuthRuntimeConfig();
  const claudeCodeAuthCallbackServer = new ClaudeCodeAuthCallbackServer();
  const claudeCodeAuthService = new DefaultClaudeCodeAuthService({
    claudeCodeAuthDao,
    config: claudeCodeAuthConfig,
    callbackServer: claudeCodeAuthCallbackServer,
  });
  claudeCodeAuthCallbackServer.setAuthService(claudeCodeAuthService);

  const codexAuthConfig = await configManager.getCodexAuthRuntimeConfig();
  const codexAuthService = new DefaultCodexAuthService({
    codexAuthDao,
    config: codexAuthConfig,
  });
  const codexAuthCallbackServer = new CodexAuthCallbackServer({
    codexAuthService,
  });
  await codexAuthCallbackServer.start();

  const claudeCodeAuthStore = new ClaudeCodeAuthStore({
    claudeCodeAuthService,
  });
  const codexAuthStore = new OpenAiCodexAuthStore({
    codexAuthService,
  });
  const llmConfig = await configManager.getLlmRuntimeConfig();
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
    "openai-codex": createOpenAiCodexProvider({
      config: llmConfig.openaiCodex,
      authStore: codexAuthStore,
    }),
    "claude-code": createClaudeCodeProvider({
      config: llmConfig.claudeCode,
      authStore: claudeCodeAuthStore,
    }),
  };
  const llmClient = createLlmClient({
    llmChatCallDao,
    providers: llmProviders,
    providerConfigs: {
      deepseek: llmConfig.deepseek,
      openai: llmConfig.openai,
      "openai-codex": llmConfig.openaiCodex,
      "claude-code": llmConfig.claudeCode,
    },
    usages: llmConfig.usages,
  });

  const ragConfig = await configManager.getRagRuntimeConfig();
  const embeddingClient = createEmbeddingClient({
    config: ragConfig.embedding,
    embeddingCacheDao,
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
  const visionAgent = new VisionAgent({
    llmClient,
  });
  const imageMessageAnalyzer = new DefaultNapcatImageMessageAnalyzer({
    visionAgent,
  });
  const agentSystemPromptFactory = async () => {
    const botProfile = await configManager.getBotProfileConfig();
    return createAgentSystemPrompt({
      botQQ: botProfile.botQQ,
    });
  };

  const tavilyConfig = await configManager.getTavilyConfig();
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
  const napcatGatewayService = await DefaultNapcatGatewayService.create({
    configManager,
    eventQueue,
    persistenceWriter: napcatPersistenceWriter,
    imageMessageAnalyzer,
  });

  const agentMessageService = new DefaultAgentMessageService({
    napcatGatewayService,
    targetGroupId: bootConfig.napcat.listenGroupId,
  });
  const replySenderToolCatalog = new ToolCatalog([
    new ReplyThoughtTool(),
    new ReviewReplyStrategyTool(),
    new WriteReplyMessageTool(),
  ]);
  const trySendMessageService = new TrySendMessageService({
    llmClient,
    agentMessageService,
    replyThoughtTools: replySenderToolCatalog.pick(["reply_thought"]),
    replyReviewTools: replySenderToolCatalog.pick(["review_reply_strategy"]),
    replyWriterTools: replySenderToolCatalog.pick(["write_reply_message"]),
  });
  const toolCatalog = new ToolCatalog([
    new SearchWebTool({
      webSearchService,
    }),
    new SendGroupMessageTool({
      agentMessageService,
    }),
    new TrySendMessageTool({
      trySendMessageService,
    }),
    new FinishTool(),
    new SearchMemoryTool({
      memorySearchService,
    }),
    new SummaryTool(),
  ]);
  const ragQueryPlanner = new RagQueryPlannerService({
    llmClient,
    plannerTools: toolCatalog.pick([SEARCH_MEMORY_TOOL_NAME]),
    systemPromptFactory: createRagSystemPrompt,
  });
  const ragContextEventEnricher = new RagContextEventEnricher({
    ragQueryPlanner,
  });
  const agentVisibleTools = toolCatalog.pick([
    SEARCH_WEB_TOOL_NAME,
    TRY_SEND_MESSAGE_TOOL_NAME,
    FINISH_TOOL_NAME,
  ]);
  const llmPlaygroundService = new DefaultLlmPlaygroundService({
    llmClient,
    playgroundToolDefinitions: toolCatalog
      .pick([
        SEARCH_WEB_TOOL_NAME,
        TRY_SEND_MESSAGE_TOOL_NAME,
        FINISH_TOOL_NAME,
        SEARCH_MEMORY_TOOL_NAME,
        SUMMARY_TOOL_NAME,
        SEND_GROUP_MESSAGE_TOOL_NAME,
      ])
      .definitions(),
  });
  const summaryPlanner = new ContextSummaryPlannerService({
    llmClient,
    summaryToolExecutor: toolCatalog.pick([SUMMARY_TOOL_NAME]),
  });
  const context = new DefaultAgentContext({
    systemPromptFactory: agentSystemPromptFactory,
  });
  const agentLoop = new AgentLoop({
    llmClient,
    context,
    eventQueue,
    agentTools: agentVisibleTools,
    ragContextEventEnricher,
    summaryPlanner,
    summaryTools: [
      ...agentVisibleTools.definitions(),
      ...toolCatalog.pick([SUMMARY_TOOL_NAME]).definitions(),
    ],
  });

  const app = createServerApp({
    handlers: [
      new HealthHandler(),
      new ClaudeCodeAuthHandler({ claudeCodeAuthService }),
      new CodexAuthHandler({ codexAuthService }),
      new LlmHandler({ llmPlaygroundService }),
      new LlmChatCallHandler({ llmChatCallQueryService }),
      new EmbeddingCacheHandler({ embeddingCacheQueryService }),
      new AppLogHandler({ appLogQueryService }),
      new NapcatEventHandler({ napcatEventQueryService }),
      new NapcatGroupMessageHandler({ napcatGroupMessageQueryService }),
      new NapcatHandler({ napcatGatewayService }),
    ],
  });

  return {
    app,
    database,
    napcatGatewayService,
    claudeCodeAuthCallbackServer,
    codexAuthCallbackServer,
    agentLoop,
    port: bootConfig.port,
    listenGroupId: bootConfig.napcat.listenGroupId,
    hasTavilyApiKey: Boolean(tavilyConfig.apiKey),
    listAvailableAgentProviders: async () => {
      return await llmClient.listAvailableProviders({ usage: "agent" });
    },
  };
}

function createServerApp({ handlers }: { handlers: AppRouteHandler[] }): FastifyInstance {
  const app = Fastify({ logger: false, disableRequestLogging: true });

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

  for (const handler of handlers) {
    handler.register(app);
  }

  return app;
}
