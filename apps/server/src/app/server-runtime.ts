import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { DefaultConfigManager } from "../config/config.impl.manager.js";
import { loadStaticConfig } from "../config/config.loader.js";
import { DefaultAgentContext } from "../agent/runtime/context/default-agent-context.js";
import { LinearMessageLedgerAgentContext } from "../agent/runtime/context/linear-message-ledger-agent-context.js";
import { createDbClient, type Database } from "../db/client.js";
import { PrismaEmbeddingCacheDao } from "../llm/dao/impl/embedding-cache.impl.dao.js";
import { PrismaLlmChatCallDao } from "../llm/dao/impl/llm-chat-call.impl.dao.js";
import { PrismaLogDao } from "../logger/dao/impl/log.impl.dao.js";
import { PrismaNapcatEventDao } from "../napcat/dao/impl/napcat-event.impl.dao.js";
import { PrismaNapcatGroupMessageChunkDao } from "../napcat/dao/impl/napcat-group-message-chunk.impl.dao.js";
import { PrismaNapcatGroupMessageDao } from "../napcat/dao/impl/napcat-group-message.impl.dao.js";
import { BizError } from "../common/errors/biz-error.js";
import { toHttpErrorResponse } from "../common/errors/http-error.js";
import { AppLogHandler } from "../ops/http/app-log.handler.js";
import { AgentDashboardHandler } from "../ops/http/agent-dashboard.handler.js";
import { EmbeddingCacheHandler } from "../ops/http/embedding-cache.handler.js";
import { HealthHandler } from "./http/health.handler.js";
import { LlmHandler } from "../llm/http/llm.handler.js";
import { LlmChatCallHandler } from "../ops/http/llm-chat-call.handler.js";
import { NapcatEventHandler } from "../ops/http/napcat-event.handler.js";
import { NapcatGroupMessageHandler } from "../ops/http/napcat-group-message.handler.js";
import { NapcatHandler } from "../napcat/http/napcat.handler.js";
import { createLlmClient } from "../llm/client.js";
import { createEmbeddingClient } from "../llm/embedding/client.js";
import type { LlmProvider } from "../llm/provider.js";
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
import { createAuthModule } from "../auth/index.js";
import { ToolCatalog } from "@kagami/agent-runtime";
import { InMemoryAgentEventQueue } from "../agent/runtime/event/in-memory-agent-event-queue.js";
import { RootLoopAgent } from "../agent/runtime/root-agent/root-agent-runtime.js";
import { PrismaRootAgentRuntimeSnapshotRepository } from "../agent/runtime/root-agent/persistence/prisma-root-agent-runtime-snapshot.repository.js";
import { ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY } from "../agent/runtime/root-agent/persistence/root-agent-runtime-snapshot.repository.js";
import { createAgentSystemPrompt } from "../agent/runtime/root-agent/system-prompt.js";
import { RootAgentSession } from "../agent/runtime/root-agent/session/root-agent-session.js";
import {
  BackToPortalTool,
  BACK_TO_PORTAL_TOOL_NAME,
} from "../agent/runtime/root-agent/tools/back-to-portal.tool.js";
import { EnterTool, ENTER_TOOL_NAME } from "../agent/runtime/root-agent/tools/enter.tool.js";
import { InvokeTool, INVOKE_TOOL_NAME } from "../agent/runtime/root-agent/tools/invoke.tool.js";
import { WaitTool, WAIT_TOOL_NAME } from "../agent/runtime/root-agent/tools/wait.tool.js";
import { GroupMessageChunkIndexer } from "../agent/capabilities/rag/application/indexer.service.js";
import { DefaultAgentMessageService } from "../agent/capabilities/messaging/application/default-agent-message.service.js";
import { SendMessageTool } from "../agent/capabilities/messaging/tools/send-message.tool.js";
import { DefaultAppLogQueryService } from "../ops/application/app-log-query.impl.service.js";
import { DefaultAgentDashboardQueryService } from "../ops/application/agent-dashboard-query.impl.service.js";
import { DefaultAgentDashboardCommandService } from "../ops/application/agent-dashboard-command.impl.service.js";
import { AuthUsageCacheManager } from "../auth/application/auth-usage-cache.impl.service.js";
import { ClaudeCodeAuthRefreshScheduler } from "../auth/application/claude-code-auth-refresh.scheduler.js";
import { DefaultEmbeddingCacheQueryService } from "../ops/application/embedding-cache-query.impl.service.js";
import { DefaultLlmChatCallQueryService } from "../ops/application/llm-chat-call-query.impl.service.js";
import { DefaultLlmPlaygroundService } from "../llm/application/llm-playground.impl.service.js";
import { NapcatEventPersistenceWriter } from "../napcat/service/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatImageMessageAnalyzer } from "../napcat/service/napcat-gateway/image-message-analyzer.js";
import { DefaultNapcatGatewayService } from "../napcat/service/napcat-gateway.impl.service.js";
import type { NapcatGatewayService } from "../napcat/service/napcat-gateway.service.js";
import { DefaultNapcatEventQueryService } from "../ops/application/napcat-event-query.impl.service.js";
import { DefaultNapcatGroupMessageQueryService } from "../ops/application/napcat-group-message-query.impl.service.js";
import { TavilyWebSearchService } from "../agent/capabilities/web-search/application/tavily-web-search.service.js";
import {
  SearchWebRawTool,
  SEARCH_WEB_RAW_TOOL_NAME,
} from "../agent/capabilities/web-search/task-agent/tools/search-web-raw.tool.js";
import {
  FinalizeWebSearchTool,
  FINALIZE_WEB_SEARCH_TOOL_NAME,
} from "../agent/capabilities/web-search/task-agent/tools/finalize-web-search.tool.js";
import { WebSearchTaskAgent } from "../agent/capabilities/web-search/task-agent/web-search-task-agent.js";
import {
  SearchWebTool,
  SEARCH_WEB_TOOL_NAME,
} from "../agent/capabilities/web-search/tools/search-web.tool.js";
import { ContextSummaryOperation } from "../agent/capabilities/context-summary/operations/context-summary.operation.js";
import {
  SummaryTool,
  SUMMARY_TOOL_NAME,
} from "../agent/capabilities/context-summary/tools/summary.tool.js";
import { VisionAgent } from "../agent/capabilities/vision/application/vision-agent.js";
import { ZoneOutTool } from "../agent/runtime/root-agent/tools/zone-out.tool.js";
import {
  OpenIthomeArticleTool,
  OPEN_ITHOME_ARTICLE_TOOL_NAME,
} from "../agent/capabilities/news/tools/open-ithome-article.tool.js";
import { PrismaNewsArticleDao } from "../news/infra/prisma-news-article.dao.js";
import { PrismaNewsFeedCursorDao } from "../news/infra/prisma-news-feed-cursor.dao.js";
import { DefaultIthomeClient } from "../news/application/ithome-client.js";
import { IthomeNewsService } from "../news/application/ithome-news.service.js";
import { IthomePoller } from "../news/application/ithome-poller.js";
import { PrismaLinearMessageLedgerDao } from "../agent/capabilities/story/infra/impl/prisma-linear-message-ledger.impl.dao.js";
import { PrismaStoryDao } from "../agent/capabilities/story/infra/impl/prisma-story.impl.dao.js";
import { PrismaStoryRagDao } from "../agent/capabilities/story/infra/impl/prisma-story-rag.impl.dao.js";
import { PrismaStoryAgentRuntimeSnapshotRepository } from "../agent/capabilities/story/runtime/persistence/prisma-story-agent-runtime-snapshot.repository.js";
import { StoryRagService } from "../agent/capabilities/story/application/story-rag.service.js";
import { StoryRecallService } from "../agent/capabilities/story/application/story-recall.service.js";
import { StoryService } from "../agent/capabilities/story/application/story.service.js";
import { StoryLoopAgent } from "../agent/capabilities/story/runtime/story-agent.runtime.js";
import {
  SearchMemoryTool,
  SEARCH_MEMORY_TOOL_NAME,
} from "../agent/capabilities/story/tools/search-memory.tool.js";

const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";
const logger = new AppLogger({ source: "bootstrap" });

type AppRouteHandler = {
  register(app: FastifyInstance): void;
};

export type ServerRuntime = {
  app: FastifyInstance;
  database: Database;
  napcatGatewayService: NapcatGatewayService;
  ithomePoller: IthomePoller;
  callbackServers: Array<{ stop(): Promise<void> }>;
  authUsageCacheManager: AuthUsageCacheManager;
  claudeCodeAuthRefreshScheduler: ClaudeCodeAuthRefreshScheduler;
  rootAgentRuntime: RootLoopAgent;
  storyAgentRuntime: StoryLoopAgent;
  restoredRootAgentSnapshot: boolean;
  port: number;
  listenGroupIds: string[];
  startupContextRecentMessageCount: number;
  hydrateColdStartAgentContext: () => Promise<void>;
  hasTavilyApiKey: boolean;
  closeLlmProviders: () => Promise<void>;
  listAvailableAgentProviders: () => Promise<
    Awaited<ReturnType<ReturnType<typeof createLlmClient>["listAvailableProviders"]>>
  >;
};

export async function buildServerRuntime(): Promise<ServerRuntime> {
  const loadedConfig = await loadStaticConfig();
  const configManager = new DefaultConfigManager({
    config: loadedConfig,
  });
  const config = await configManager.config();

  const database = createDbClient({
    databaseUrl: config.server.databaseUrl,
  });

  const logDao = new PrismaLogDao({ database });
  const rootAgentRuntimeSnapshotRepository = new PrismaRootAgentRuntimeSnapshotRepository({
    database,
  });
  const storyAgentRuntimeSnapshotRepository = new PrismaStoryAgentRuntimeSnapshotRepository({
    database,
  });
  initLoggerRuntime({
    sinks: [new StdoutLogSink(), new DbLogSink({ logDao })],
  });

  const authModule = await createAuthModule({
    database,
    configManager,
  });
  const llmChatCallDao = new PrismaLlmChatCallDao({ database });
  const embeddingCacheDao = new PrismaEmbeddingCacheDao({ database });
  const napcatEventDao = new PrismaNapcatEventDao({ database });
  const napcatGroupMessageDao = new PrismaNapcatGroupMessageDao({ database });
  const napcatGroupMessageChunkDao = new PrismaNapcatGroupMessageChunkDao({
    database,
  });
  const newsArticleDao = new PrismaNewsArticleDao({ database });
  const newsFeedCursorDao = new PrismaNewsFeedCursorDao({ database });
  const linearMessageLedgerDao = new PrismaLinearMessageLedgerDao({ database });
  const storyDao = new PrismaStoryDao({ database });
  const storyRagDao = new PrismaStoryRagDao({ database });
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

  const claudeCodeAuthStore = new ClaudeCodeAuthStore({
    claudeCodeAuthService: authModule.authServices["claude-code"],
  });
  const codexAuthStore = new OpenAiCodexAuthStore({
    codexAuthService: authModule.authServices.codex,
  });
  const llmTimeoutMs = config.server.llm.timeoutMs;
  const deepseekConfig = {
    ...config.server.llm.providers.deepseek,
    timeoutMs: llmTimeoutMs,
  };
  const openAiConfig = {
    ...config.server.llm.providers.openai,
    timeoutMs: llmTimeoutMs,
  };
  const openAiCodexConfig = {
    ...config.server.llm.providers.openaiCodex,
    timeoutMs: llmTimeoutMs,
  };
  const claudeCodeConfig = {
    apiKey: undefined,
    ...config.server.llm.providers.claudeCode,
    timeoutMs: llmTimeoutMs,
  };
  const llmProviders = {
    deepseek: deepseekConfig.apiKey
      ? createDeepSeekProvider({
          ...deepseekConfig,
          apiKey: deepseekConfig.apiKey,
        })
      : undefined,
    openai: openAiConfig.apiKey
      ? createOpenAiProvider({
          ...openAiConfig,
          apiKey: openAiConfig.apiKey,
        })
      : undefined,
    "openai-codex": createOpenAiCodexProvider({
      config: openAiCodexConfig,
      authStore: codexAuthStore,
    }),
    "claude-code": createClaudeCodeProvider({
      config: claudeCodeConfig,
      authStore: claudeCodeAuthStore,
    }),
  };
  const llmClient = createLlmClient({
    llmChatCallDao,
    providers: llmProviders,
    providerConfigs: {
      deepseek: deepseekConfig,
      openai: openAiConfig,
      "openai-codex": openAiCodexConfig,
      "claude-code": claudeCodeConfig,
    },
    usages: config.server.llm.usages,
  });

  const embeddingClient = createEmbeddingClient({
    config: config.server.rag.embedding,
    embeddingCacheDao,
  });
  const storyRagService = new StoryRagService({
    storyRagDao,
    embeddingClient,
    outputDimensionality: config.server.rag.embedding.outputDimensionality,
  });
  const storyService = new StoryService({
    storyDao,
    storyRagService,
  });
  const storyRecallService = new StoryRecallService({
    storyRagDao,
    storyDao,
    embeddingClient,
    outputDimensionality: config.server.rag.embedding.outputDimensionality,
  });
  const groupMessageChunkIndexer = new GroupMessageChunkIndexer({
    chunkDao: napcatGroupMessageChunkDao,
    embeddingClient,
    outputDimensionality: config.server.rag.embedding.outputDimensionality,
  });
  const visionAgent = new VisionAgent({
    llmClient,
  });
  const imageMessageAnalyzer = new DefaultNapcatImageMessageAnalyzer({
    visionAgent,
  });
  const agentSystemPromptFactory = async () => {
    return createAgentSystemPrompt({
      botQQ: config.server.bot.qq,
      creatorName: config.server.bot.creator.name,
      creatorQQ: config.server.bot.creator.qq,
    });
  };

  const webSearchService = new TavilyWebSearchService({
    apiKey: config.server.tavily.apiKey,
  });
  const webSearchInternalToolCatalog = new ToolCatalog([
    new SearchWebRawTool({
      webSearchService,
    }),
    new FinalizeWebSearchTool(),
  ]);
  const webSearchTaskAgent = new WebSearchTaskAgent({
    llmClient,
    taskTools: webSearchInternalToolCatalog.pick([
      SEARCH_WEB_RAW_TOOL_NAME,
      FINALIZE_WEB_SEARCH_TOOL_NAME,
    ]),
  });
  const napcatPersistenceWriter = new NapcatEventPersistenceWriter({
    napcatEventDao,
    napcatGroupMessageDao,
    napcatGroupMessageChunkDao,
    groupMessageChunkIndexer,
  });
  const eventQueue = new InMemoryAgentEventQueue();
  const ithomeNewsService = new IthomeNewsService({
    articleDao: newsArticleDao,
    cursorDao: newsFeedCursorDao,
    ithomeClient: new DefaultIthomeClient(),
    recentArticleLimit: config.server.news.ithome.recentArticleLimit,
    articleMaxChars: config.server.news.ithome.articleMaxChars,
  });
  const ithomePoller = new IthomePoller({
    ithomeNewsService,
    pollIntervalMs: config.server.news.ithome.pollIntervalMs,
    onArticleIngested: article => {
      eventQueue.enqueue({
        type: "news_article_ingested",
        data: {
          sourceKey: "ithome",
          articleId: article.articleId,
          title: article.title,
        },
      });
    },
  });
  ithomePoller.start();
  const napcatGatewayService = await DefaultNapcatGatewayService.create({
    configManager,
    enqueueGroupMessageEvent: event => eventQueue.enqueue(event),
    persistenceWriter: napcatPersistenceWriter,
    imageMessageAnalyzer,
  });
  const agentMessageService = new DefaultAgentMessageService({
    napcatGatewayService,
  });
  const context = new LinearMessageLedgerAgentContext({
    inner: new DefaultAgentContext({
      systemPromptFactory: agentSystemPromptFactory,
    }),
    linearMessageLedgerDao,
    runtimeKey: ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  });
  const rootAgentSession = new RootAgentSession({
    context,
    napcatGatewayService,
    listenGroupIds: config.server.napcat.listenGroupIds,
    recentMessageLimit: config.server.napcat.startupContextRecentMessageCount,
    ithomeNewsService,
  });
  const toolCatalog = new ToolCatalog([
    new EnterTool(),
    new BackToPortalTool(),
    new WaitTool({
      maxWaitMs: config.server.agent.waitToolMaxWaitMs,
    }),
    new InvokeTool({
      tools: [
        new SendMessageTool({
          agentMessageService,
        }),
        new ZoneOutTool(),
      ],
    }),
    new OpenIthomeArticleTool(),
    new SearchWebTool({
      webSearchTaskAgent,
    }),
    new SearchMemoryTool({
      storyRecallService,
      topK: config.server.rag.retrieval.topK,
    }),
    new SummaryTool(),
  ]);
  const rootAgentTools = toolCatalog.pick([
    ENTER_TOOL_NAME,
    BACK_TO_PORTAL_TOOL_NAME,
    WAIT_TOOL_NAME,
    INVOKE_TOOL_NAME,
    OPEN_ITHOME_ARTICLE_TOOL_NAME,
    SEARCH_WEB_TOOL_NAME,
    SEARCH_MEMORY_TOOL_NAME,
  ]);
  const summaryToolExecutor = toolCatalog.pick([SUMMARY_TOOL_NAME]);
  const contextSummaryOperation = new ContextSummaryOperation({
    llmClient,
    summaryToolExecutor,
  });
  const storyAgentRuntime = new StoryLoopAgent({
    llmClient,
    linearMessageLedgerDao,
    snapshotRepository: storyAgentRuntimeSnapshotRepository,
    storyService,
    storyRecallService,
    contextSummaryOperation,
    summaryTools: summaryToolExecutor.definitions(),
    contextCompactionThreshold: config.server.agent.contextCompactionThreshold,
    batchSize: config.server.agent.story.batchSize,
    idleFlushMs: config.server.agent.story.idleFlushMs,
    candidateTopK: Math.max(5, config.server.rag.retrieval.topK),
    sourceRuntimeKey: ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  });
  const rootAgentRuntime = new RootLoopAgent({
    llmClient,
    context,
    eventQueue,
    session: rootAgentSession,
    snapshotRepository: rootAgentRuntimeSnapshotRepository,
    tools: rootAgentTools,
    contextSummaryOperation,
    contextCompactionThreshold: config.server.agent.contextCompactionThreshold,
    llmRetryBackoffMs: config.server.agent.llmRetryBackoffMs,
    summaryTools: [
      ...rootAgentTools.definitions(),
      ...toolCatalog.pick([SUMMARY_TOOL_NAME]).definitions(),
    ],
  });
  const restoredSnapshot = await rootAgentRuntimeSnapshotRepository.load(
    ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  );
  let restoredRootAgentSnapshot = false;
  if (restoredSnapshot) {
    await rootAgentRuntime.restorePersistedSnapshot(restoredSnapshot);
    restoredRootAgentSnapshot = true;
  }
  const llmPlaygroundService = new DefaultLlmPlaygroundService({
    llmClient,
    playgroundToolDefinitions: toolCatalog
      .pick([
        ENTER_TOOL_NAME,
        WAIT_TOOL_NAME,
        INVOKE_TOOL_NAME,
        OPEN_ITHOME_ARTICLE_TOOL_NAME,
        SEARCH_WEB_TOOL_NAME,
        SEARCH_MEMORY_TOOL_NAME,
        BACK_TO_PORTAL_TOOL_NAME,
        SUMMARY_TOOL_NAME,
      ])
      .definitions(),
  });
  const agentDashboardQueryService = new DefaultAgentDashboardQueryService({
    rootAgentRuntime,
    eventQueue,
    listenGroupIds: config.server.napcat.listenGroupIds,
    listAvailableAgentProviders: async () => {
      return await llmClient.listAvailableProviders({ usage: "agent" });
    },
  });
  const agentDashboardCommandService = new DefaultAgentDashboardCommandService({
    rootAgentRuntime,
  });

  const app = createServerApp({
    handlers: [
      new HealthHandler(),
      authModule.authHandler,
      new LlmHandler({ llmPlaygroundService }),
      new AgentDashboardHandler({
        agentDashboardQueryService,
        agentDashboardCommandService,
      }),
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
    ithomePoller,
    callbackServers: authModule.callbackServers,
    authUsageCacheManager: authModule.authUsageCacheManager,
    claudeCodeAuthRefreshScheduler: authModule.claudeCodeAuthRefreshScheduler,
    rootAgentRuntime,
    storyAgentRuntime,
    restoredRootAgentSnapshot,
    port: config.server.port,
    listenGroupIds: config.server.napcat.listenGroupIds,
    startupContextRecentMessageCount: config.server.napcat.startupContextRecentMessageCount,
    hydrateColdStartAgentContext: async () => {
      const { hydrateStartupContextFromRecentMessages } =
        await import("./startup-context-hydrator.js");

      await hydrateStartupContextFromRecentMessages({
        listenGroupIds: config.server.napcat.listenGroupIds,
        startupContextRecentMessageCount: config.server.napcat.startupContextRecentMessageCount,
        napcatGatewayService,
        rootAgentRuntime,
      });
    },
    hasTavilyApiKey: Boolean(config.server.tavily.apiKey),
    closeLlmProviders: async () => {
      await closeLlmProviders(llmProviders);
    },
    listAvailableAgentProviders: async () => {
      return await llmClient.listAvailableProviders({ usage: "agent" });
    },
  };
}

async function closeLlmProviders(
  providers: Partial<Record<string, LlmProvider | undefined>>,
): Promise<void> {
  await Promise.all(
    Object.values(providers).map(async provider => {
      if (!provider?.close) {
        return;
      }

      await provider.close();
    }),
  );
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
