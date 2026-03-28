import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AgentLoop,
  MultiGroupAgentRuntimeManager,
  createAgentSystemPrompt,
} from "../agent/agents/main-engine/index.js";
import { ContextSummaryPlannerService } from "../agent/agents/subagents/context-summarizer/index.js";
import { VisionAgent } from "../agent/agents/subagents/vision/index.js";
import {
  FINALIZE_WEB_SEARCH_TOOL_NAME,
  FinalizeWebSearchTool,
  SEARCH_WEB_RAW_TOOL_NAME,
  SearchWebRawTool,
  WebSearchAgent,
} from "../agent/agents/subagents/web-search/index.js";
import { DefaultConfigManager } from "../config/config.impl.manager.js";
import { loadStaticConfig } from "../config/config.loader.js";
import { DefaultAgentContext } from "../agent/context/default-agent-context.js";
import { createDbClient, type Database } from "../db/client.js";
import { PrismaEmbeddingCacheDao } from "../llm/dao/impl/embedding-cache.impl.dao.js";
import { PrismaLlmChatCallDao } from "../llm/dao/impl/llm-chat-call.impl.dao.js";
import { PrismaLoopRunDao } from "../agent/dao/impl/loop-run.impl.dao.js";
import { PrismaLogDao } from "../logger/dao/impl/log.impl.dao.js";
import { PrismaNapcatEventDao } from "../napcat/dao/impl/napcat-event.impl.dao.js";
import { PrismaNapcatGroupMessageChunkDao } from "../napcat/dao/impl/napcat-group-message-chunk.impl.dao.js";
import { PrismaNapcatGroupMessageDao } from "../napcat/dao/impl/napcat-group-message.impl.dao.js";
import { BizError } from "../common/errors/biz-error.js";
import { toHttpErrorResponse } from "../common/errors/http-error.js";
import { AppLogHandler } from "../ops/http/app-log.handler.js";
import { EmbeddingCacheHandler } from "../ops/http/embedding-cache.handler.js";
import { HealthHandler } from "./http/health.handler.js";
import { LlmHandler } from "../llm/http/llm.handler.js";
import { LlmChatCallHandler } from "../ops/http/llm-chat-call.handler.js";
import { LoopRunHandler } from "../ops/http/loop-run.handler.js";
import { NapcatEventHandler } from "../ops/http/napcat-event.handler.js";
import { NapcatGroupMessageHandler } from "../ops/http/napcat-group-message.handler.js";
import { NapcatHandler } from "../napcat/http/napcat.handler.js";
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
import { createAuthModule } from "../auth/index.js";
import { InMemoryAgentEventQueue } from "../agent/event/event.impl.queue.js";
import { GroupMessageChunkIndexer } from "../agent/rag/indexer.service.js";
import { DefaultAgentMessageService } from "../agent/service/agent-message.impl.service.js";
import { DefaultAppLogQueryService } from "../ops/application/app-log-query.impl.service.js";
import { AuthUsageCacheManager } from "../auth/application/auth-usage-cache.impl.service.js";
import { DefaultEmbeddingCacheQueryService } from "../ops/application/embedding-cache-query.impl.service.js";
import { DefaultLlmChatCallQueryService } from "../ops/application/llm-chat-call-query.impl.service.js";
import { DefaultLlmPlaygroundService } from "../llm/application/llm-playground.impl.service.js";
import { DefaultLoopRunQueryService } from "../ops/application/loop-run-query.impl.service.js";
import { LoopRunRecorder } from "../agent/service/loop-run-recorder.service.js";
import { NapcatEventPersistenceWriter } from "../napcat/service/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatImageMessageAnalyzer } from "../napcat/service/napcat-gateway/image-message-analyzer.js";
import { DefaultNapcatGatewayService } from "../napcat/service/napcat-gateway.impl.service.js";
import type { NapcatGatewayService } from "../napcat/service/napcat-gateway.service.js";
import { DefaultNapcatEventQueryService } from "../ops/application/napcat-event-query.impl.service.js";
import { DefaultNapcatGroupMessageQueryService } from "../ops/application/napcat-group-message-query.impl.service.js";
import { TavilyWebSearchService } from "../agent/service/tavily-web-search.impl.service.js";
import {
  FINISH_TOOL_NAME,
  FinishTool,
  SEARCH_WEB_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SearchWebTool,
  SendMessageTool,
  SUMMARY_TOOL_NAME,
  SummaryTool,
  ToolCatalog,
} from "../agent/tools/index.js";

const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";
const logger = new AppLogger({ source: "bootstrap" });

type AppRouteHandler = {
  register(app: FastifyInstance): void;
};

export type ServerRuntime = {
  app: FastifyInstance;
  database: Database;
  napcatGatewayService: NapcatGatewayService;
  callbackServers: Array<{ stop(): Promise<void> }>;
  authUsageCacheManager: AuthUsageCacheManager;
  agentRuntimeManager: MultiGroupAgentRuntimeManager;
  port: number;
  listenGroupIds: string[];
  hasTavilyApiKey: boolean;
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
  initLoggerRuntime({
    sinks: [new StdoutLogSink(), new DbLogSink({ logDao })],
  });

  const authModule = await createAuthModule({
    database,
    configManager,
  });
  const llmChatCallDao = new PrismaLlmChatCallDao({ database });
  const loopRunDao = new PrismaLoopRunDao({ database });
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
  const loopRunQueryService = new DefaultLoopRunQueryService({ loopRunDao });
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
  const webSearchAgent = new WebSearchAgent({
    llmClient,
    searchTools: webSearchInternalToolCatalog.pick([
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
  let agentRuntimeManager: MultiGroupAgentRuntimeManager | null = null;
  const napcatGatewayService = await DefaultNapcatGatewayService.create({
    configManager,
    enqueueGroupMessageEvent: event => {
      if (!agentRuntimeManager) {
        throw new Error("Agent runtime manager is not initialized");
      }

      return agentRuntimeManager.enqueue(event);
    },
    persistenceWriter: napcatPersistenceWriter,
    imageMessageAnalyzer,
  });

  const loopRunRecorder = new LoopRunRecorder({
    loopRunDao,
  });
  const groupRuntimes = config.server.napcat.listenGroupIds.map(groupId => {
    const eventQueue = new InMemoryAgentEventQueue();
    const agentMessageService = new DefaultAgentMessageService({
      napcatGatewayService,
      targetGroupId: groupId,
    });
    const toolCatalog = new ToolCatalog([
      new SearchWebTool({
        webSearchAgent,
      }),
      new SendMessageTool({
        agentMessageService,
      }),
      new FinishTool(),
      new SummaryTool(),
    ]);
    const agentVisibleTools = toolCatalog.pick([
      SEARCH_WEB_TOOL_NAME,
      SEND_MESSAGE_TOOL_NAME,
      FINISH_TOOL_NAME,
    ]);
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
      summaryPlanner,
      summaryTools: [
        ...agentVisibleTools.definitions(),
        ...toolCatalog.pick([SUMMARY_TOOL_NAME]).definitions(),
      ],
      loopRunRecorder,
    });

    return {
      groupId,
      eventQueue,
      agentLoop,
      toolCatalog,
    };
  });
  agentRuntimeManager = new MultiGroupAgentRuntimeManager({
    runtimes: groupRuntimes.map(({ groupId, eventQueue, agentLoop }) => ({
      groupId,
      eventQueue,
      agentLoop,
    })),
  });
  const llmPlaygroundService = new DefaultLlmPlaygroundService({
    llmClient,
    playgroundToolDefinitions: groupRuntimes[0].toolCatalog
      .pick([SEARCH_WEB_TOOL_NAME, SEND_MESSAGE_TOOL_NAME, FINISH_TOOL_NAME, SUMMARY_TOOL_NAME])
      .definitions(),
  });

  const app = createServerApp({
    handlers: [
      new HealthHandler(),
      authModule.authHandler,
      new LlmHandler({ llmPlaygroundService }),
      new LlmChatCallHandler({ llmChatCallQueryService }),
      new LoopRunHandler({ loopRunQueryService }),
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
    callbackServers: authModule.callbackServers,
    authUsageCacheManager: authModule.authUsageCacheManager,
    agentRuntimeManager,
    port: config.server.port,
    listenGroupIds: config.server.napcat.listenGroupIds,
    hasTavilyApiKey: Boolean(config.server.tavily.apiKey),
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
