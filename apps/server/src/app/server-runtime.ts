import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { InMemoryQueue } from "@kagami/agent-runtime";
import { DefaultConfigManager } from "../config/config.impl.manager.js";
import { loadStaticConfig } from "../config/config.loader.js";
import { createDbClient, type Database } from "../db/client.js";
import { PrismaLlmChatCallDao } from "../llm/dao/impl/llm-chat-call.impl.dao.js";
import { PrismaLogDao } from "../logger/dao/impl/log.impl.dao.js";
import { PrismaNapcatEventDao } from "../napcat/dao/impl/napcat-event.impl.dao.js";
import { PrismaNapcatQqMessageDao } from "../napcat/dao/impl/napcat-group-message.impl.dao.js";
import { BizError } from "../common/errors/biz-error.js";
import { toHttpErrorResponse } from "../common/errors/http-error.js";
import { AppLogHandler } from "../ops/http/app-log.handler.js";
import { MainAgentContextHandler } from "../ops/http/main-agent-context.handler.js";
import { HealthHandler } from "./http/health.handler.js";
import { LlmHandler } from "../llm/http/llm.handler.js";
import { LlmChatCallHandler } from "../ops/http/llm-chat-call.handler.js";
import { NapcatEventHandler } from "../ops/http/napcat-event.handler.js";
import { NapcatQqMessageHandler } from "../ops/http/napcat-group-message.handler.js";
import { NapcatHandler } from "../napcat/http/napcat.handler.js";
import { createLlmClient } from "../llm/client.js";
import { createEmbeddingClient } from "../llm/embedding/client.js";
import { PrismaEmbeddingCacheDao } from "../llm/embedding/prisma-embedding-cache.dao.js";
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
import type { Event } from "../agent/runtime/event/event.js";
import type { StoryAgentEvent } from "../agent/capabilities/story/runtime/story-event.js";
import type { RootLoopAgent } from "../agent/runtime/root-agent/root-agent-runtime.js";
import type { StoryLoopAgent } from "../agent/capabilities/story/runtime/story-agent.runtime.js";
import { DefaultAppLogQueryService } from "../ops/application/app-log-query.impl.service.js";
import { buildAuthScheduledTasks } from "../auth/application/auth-scheduled-tasks.js";
import { buildIthomeScheduledTasks } from "../agent/capabilities/ithome/application/ithome-scheduled-tasks.js";
import { TaskScheduler } from "../scheduler/application/task-scheduler.js";
import { buildDataRetentionTasks } from "../scheduler/tasks/data-retention/data-retention-task.factory.js";
import { SchedulerHandler } from "../scheduler/http/scheduler.handler.js";
import { DefaultLlmChatCallQueryService } from "../ops/application/llm-chat-call-query.impl.service.js";
import { NapcatEventPersistenceWriter } from "../napcat/service/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatImageMessageAnalyzer } from "../napcat/service/napcat-gateway/image-message-analyzer.js";
import { DefaultNapcatGatewayService } from "../napcat/service/napcat-gateway.impl.service.js";
import type {
  NapcatAgentEvent,
  NapcatGatewayService,
} from "../napcat/service/napcat-gateway.service.js";
import { DefaultNapcatEventQueryService } from "../ops/application/napcat-event-query.impl.service.js";
import { DefaultNapcatQqMessageQueryService } from "../ops/application/napcat-group-message-query.impl.service.js";
import { VisionAgent } from "../agent/capabilities/vision/application/vision-agent.js";
import { PrismaIthomeArticleDao } from "../agent/capabilities/ithome/infra/prisma-ithome-article.dao.js";
import { PrismaIthomeFeedCursorDao } from "../agent/capabilities/ithome/infra/prisma-ithome-feed-cursor.dao.js";
import { DefaultIthomeClient } from "../agent/capabilities/ithome/application/ithome-client.js";
import { IthomeService } from "../agent/capabilities/ithome/application/ithome.service.js";
import { IthomePoller } from "../agent/capabilities/ithome/application/ithome-poller.js";
import { IthomeNotificationDraft } from "../agent/apps/ithome/ithome-notification-draft.js";
import { NotificationCenter } from "../agent/runtime/root-agent/notification/notification-center.js";
import { StoryHandler } from "../ops/http/story.handler.js";
import type { MetricService } from "../metric/application/metric.service.js";
import { DefaultMetricService } from "../metric/application/metric.impl.service.js";
import type { MetricChartService } from "../metric/application/metric-chart.service.js";
import { DefaultMetricChartService } from "../metric/application/metric-chart.impl.service.js";
import { PrismaMetricDao } from "../metric/infra/impl/prisma-metric.impl.dao.js";
import { PrismaMetricChartDao } from "../metric/infra/impl/prisma-metric-chart.impl.dao.js";
import type { MetricChartDao } from "../metric/infra/metric-chart.dao.js";
import { MetricChartHandler } from "../metric/http/metric-chart.handler.js";
import { buildAgentRuntime } from "./agent-runtime.factory.js";

const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";
const logger = new AppLogger({ source: "bootstrap" });

type AppRouteHandler = {
  register(app: FastifyInstance): void;
};

export type ServerRuntime = {
  app: FastifyInstance;
  database: Database;
  napcatGatewayService: NapcatGatewayService;
  taskScheduler: TaskScheduler;
  callbackServers: Array<{ stop(): Promise<void> }>;
  rootAgentRuntime: RootLoopAgent;
  storyAgentRuntime: StoryLoopAgent;
  metricService: MetricService;
  metricChartService: MetricChartService;
  metricChartDao: MetricChartDao;
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
  const metricDao = new PrismaMetricDao({ database });
  const metricChartDao = new PrismaMetricChartDao({ database });
  const metricService = new DefaultMetricService({ metricDao });
  const metricChartService = new DefaultMetricChartService({
    metricDao,
    metricChartDao,
  });
  initLoggerRuntime({
    sinks: [new StdoutLogSink(), new DbLogSink({ logDao })],
  });

  const authModule = await createAuthModule({
    database,
    configManager,
  });
  const llmChatCallDao = new PrismaLlmChatCallDao({ database });
  const napcatEventDao = new PrismaNapcatEventDao({ database });
  const napcatQqMessageDao = new PrismaNapcatQqMessageDao({ database });
  const ithomeArticleDao = new PrismaIthomeArticleDao({ database });
  const ithomeFeedCursorDao = new PrismaIthomeFeedCursorDao({ database });
  const embeddingCacheDao = new PrismaEmbeddingCacheDao({ database });
  const llmChatCallQueryService = new DefaultLlmChatCallQueryService({
    llmChatCallDao,
  });
  const appLogQueryService = new DefaultAppLogQueryService({ logDao });
  const napcatEventQueryService = new DefaultNapcatEventQueryService({
    napcatEventDao,
  });
  const napcatQqMessageQueryService = new DefaultNapcatQqMessageQueryService({
    napcatQqMessageDao,
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
    metricService,
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
    config: config.server.agent.story.memory.embedding,
    cacheDao: embeddingCacheDao,
  });
  const visionAgent = new VisionAgent({
    llmClient,
  });
  const imageMessageAnalyzer = new DefaultNapcatImageMessageAnalyzer({
    visionAgent,
  });
  const napcatPersistenceWriter = new NapcatEventPersistenceWriter({
    napcatEventDao,
    napcatQqMessageDao,
  });
  const eventQueue = new InMemoryQueue<Event>();
  const storyEventQueue = new InMemoryQueue<StoryAgentEvent>();
  // 手机 OS 模型：被动通知中心。各源（这里是 ithome poller）向它 push draft，它窗口
  // 聚合后把一条 notification 事件塞进事件队列——既投递内容也唤醒 Agent。
  const notificationCenter = new NotificationCenter({
    windowMs: config.server.agent.notificationBatchWindowMs,
    onFlush: lines => {
      eventQueue.enqueue({ type: "notification", data: { lines } });
    },
  });
  const ithomeService = new IthomeService({
    articleDao: ithomeArticleDao,
    cursorDao: ithomeFeedCursorDao,
    ithomeClient: new DefaultIthomeClient(),
    recentArticleLimit: config.server.ithome.recentArticleLimit,
    articleMaxChars: config.server.ithome.articleMaxChars,
  });
  const ithomePoller = new IthomePoller({
    ithomeService,
    pollIntervalMs: config.server.ithome.pollIntervalMs,
    onArticleIngested: article => {
      notificationCenter.push(new IthomeNotificationDraft({ title: article.title }));
    },
  });
  // 手机 OS 模型：napcat 事件不再进共享事件队列，直达 QQ App。QqApp 在
  // buildAgentRuntime 里才构造，这里用 late-bind holder 接线。
  let onNapcatEvent: ((event: NapcatAgentEvent) => void) | null = null;
  const napcatGatewayService = await DefaultNapcatGatewayService.create({
    configManager,
    enqueueGroupMessageEvent: event => {
      onNapcatEvent?.(event);
      return 0;
    },
    persistenceWriter: napcatPersistenceWriter,
    imageMessageAnalyzer,
    qqMessageDao: napcatQqMessageDao,
  });

  const agentRuntime = await buildAgentRuntime({
    config,
    database,
    llmClient,
    embeddingClient,
    metricService,
    napcatGatewayService,
    ithomeService,
    notificationCenter,
    eventQueue,
    storyEventQueue,
  });
  onNapcatEvent = event => agentRuntime.qqApp.handleNapcatEvent(event);

  const taskScheduler = new TaskScheduler();
  const [codexAuthRefreshScheduler, claudeCodeAuthRefreshScheduler] =
    authModule.authRefreshSchedulers;
  if (!codexAuthRefreshScheduler || !claudeCodeAuthRefreshScheduler) {
    throw new Error("auth module did not provide both OAuth refresh schedulers");
  }
  for (const task of buildAuthScheduledTasks({
    codexAuthRefreshScheduler,
    claudeCodeAuthRefreshScheduler,
    authUsageCacheManager: authModule.authUsageCacheManager,
  })) {
    taskScheduler.register(task);
  }
  for (const task of buildIthomeScheduledTasks({ ithomePoller })) {
    taskScheduler.register(task);
  }
  for (const task of buildDataRetentionTasks({ db: database, metricService })) {
    taskScheduler.register(task);
  }

  const app = createServerApp({
    handlers: [
      new HealthHandler(),
      authModule.authHandler,
      new LlmHandler({ llmPlaygroundService: agentRuntime.llmPlaygroundService }),
      new MainAgentContextHandler({
        mainAgentContextQueryService: agentRuntime.mainAgentContextQueryService,
      }),
      new LlmChatCallHandler({ llmChatCallQueryService }),
      new AppLogHandler({ appLogQueryService }),
      new MetricChartHandler({ metricChartService }),
      new NapcatEventHandler({ napcatEventQueryService }),
      new NapcatQqMessageHandler({ napcatQqMessageQueryService }),
      new StoryHandler({
        storyQueryService: agentRuntime.storyQueryService,
        storyReindexService: agentRuntime.storyReindexService,
      }),
      new NapcatHandler({ napcatGatewayService }),
      new SchedulerHandler({ taskScheduler }),
    ],
  });

  return {
    app,
    database,
    napcatGatewayService,
    taskScheduler,
    callbackServers: authModule.callbackServers,
    rootAgentRuntime: agentRuntime.rootAgentRuntime,
    storyAgentRuntime: agentRuntime.storyAgentRuntime,
    metricService,
    metricChartService,
    metricChartDao,
    restoredRootAgentSnapshot: agentRuntime.restoredRootAgentSnapshot,
    port: config.server.port,
    listenGroupIds: config.server.napcat.listenGroupIds,
    startupContextRecentMessageCount: config.server.napcat.startupContextRecentMessageCount,
    hydrateColdStartAgentContext: agentRuntime.hydrateColdStartAgentContext,
    hasTavilyApiKey: agentRuntime.hasTavilyApiKey,
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
