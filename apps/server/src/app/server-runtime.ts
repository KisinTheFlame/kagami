import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { InMemoryQueue } from "@kagami/agent-runtime";
import { DefaultConfigManager } from "@kagami/server-core/config/config.impl.manager";
import { loadStaticConfig } from "@kagami/server-core/config/config.loader";
import { configureSqlite, createDbClient, type Database } from "@kagami/server-core/db/client";
import { PrismaLlmChatCallDao } from "@kagami/server-core/dao/impl/llm-chat-call.impl.dao";
import { PrismaLogDao } from "@kagami/server-core/logger/dao/impl/log.impl.dao";
import { PrismaImageAssetDao } from "../napcat/infra/impl/image-asset.impl.dao.js";
import { PrismaNapcatEventDao } from "@kagami/server-core/dao/impl/napcat-event.impl.dao";
import { PrismaNapcatQqMessageDao } from "@kagami/server-core/dao/impl/napcat-group-message.impl.dao";
import { BizError } from "@kagami/server-core/common/errors/biz-error";
import { toHttpErrorResponse } from "@kagami/server-core/common/errors/http-error";
import { MainAgentContextHandler } from "../ops/http/main-agent-context.handler.js";
import { HealthHandler } from "./http/health.handler.js";
import { LlmHandler } from "../llm/http/llm.handler.js";
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
import { AppLogger } from "@kagami/server-core/logger/logger";
import { initLoggerRuntime, withTraceContext } from "@kagami/server-core/logger/runtime";
import { DbLogSink } from "@kagami/server-core/logger/sinks/db-sink";
import { StdoutLogSink } from "@kagami/server-core/logger/sinks/stdout-sink";
import { createAuthModule } from "../auth/index.js";
import type { Event } from "../agent/runtime/event/event.js";
import type { StoryAgentEvent } from "../agent/capabilities/story/runtime/story-event.js";
import type { RootLoopAgent } from "../agent/runtime/root-agent/root-agent-runtime.js";
import type { StoryLoopAgent } from "../agent/capabilities/story/runtime/story-agent.runtime.js";
import { buildAuthScheduledTasks } from "../auth/application/auth-scheduled-tasks.js";
import { buildIthomeScheduledTasks } from "../agent/capabilities/ithome/application/ithome-scheduled-tasks.js";
import { TaskScheduler } from "../scheduler/application/task-scheduler.js";
import { buildDataRetentionTasks } from "../scheduler/tasks/data-retention/data-retention-task.factory.js";
import { SchedulerHandler } from "../scheduler/http/scheduler.handler.js";
import { NapcatEventPersistenceWriter } from "../napcat/application/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatImageMessageAnalyzer } from "../napcat/application/napcat-gateway/image-message-analyzer.js";
import { HttpOssClient } from "../oss/oss-client.js";
import { VisionAgent } from "../agent/capabilities/vision/application/vision-agent.js";
import { PrismaIthomeArticleDao } from "../agent/capabilities/ithome/infra/prisma-ithome-article.dao.js";
import { PrismaIthomeFeedCursorDao } from "../agent/capabilities/ithome/infra/prisma-ithome-feed-cursor.dao.js";
import { DefaultIthomeClient } from "../agent/capabilities/ithome/application/ithome-client.js";
import { IthomeService } from "../agent/capabilities/ithome/application/ithome.service.js";
import { IthomePoller } from "../agent/capabilities/ithome/application/ithome-poller.js";
import { IthomeNotificationDraft } from "../agent/apps/ithome/ithome-notification-draft.js";
import { PrismaTodoDao } from "../agent/capabilities/todo/infra/prisma-todo.dao.js";
import { TodoService } from "../agent/capabilities/todo/application/todo.service.js";
import { TodoReminderPoller } from "../agent/capabilities/todo/application/todo-reminder-poller.js";
import { buildTodoScheduledTasks } from "../agent/capabilities/todo/application/todo-scheduled-tasks.js";
import { TodoReminderDraft } from "../agent/apps/todo/todo-reminder-draft.js";
import { TodoDigestDraft } from "../agent/apps/todo/todo-digest-draft.js";
import { NotificationCenter } from "../agent/runtime/root-agent/notification/notification-center.js";
import { StoryHandler } from "../ops/http/story.handler.js";
import type { MetricService } from "../metric/application/metric.service.js";
import { DefaultMetricService } from "../metric/application/metric.impl.service.js";
import { PrismaMetricDao } from "@kagami/server-core/dao/impl/prisma-metric.impl.dao";
import { buildAgentRuntime } from "./agent-runtime.factory.js";

const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";
const logger = new AppLogger({ source: "bootstrap" });

type AppRouteHandler = {
  register(app: FastifyInstance): void;
};

export type ServerRuntime = {
  app: FastifyInstance;
  database: Database;
  /** 反序关停所有 App（含 QQ App 停 napcat 网关）。取代旧的裸 napcatGatewayService.stop。 */
  shutdownApps: () => Promise<void>;
  taskScheduler: TaskScheduler;
  callbackServers: Array<{ stop(): Promise<void> }>;
  rootAgentRuntime: RootLoopAgent;
  storyAgentRuntime: StoryLoopAgent;
  /** Story Agent 后台 loop 是否启用；false 时 index 不会 initialize/run 它。 */
  storyAgentEnabled: boolean;
  metricService: MetricService;
  port: number;
  listenGroupIds: string[];
  startupContextRecentMessageCount: number;
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
  // 与 console 进程并发读写同一 SQLite 文件：开 WAL（库文件级持久设置，设一次长期生效）。
  await configureSqlite(database);

  const logDao = new PrismaLogDao({ database });
  const metricDao = new PrismaMetricDao({ database });
  const metricService = new DefaultMetricService({ metricDao });
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
  const imageAssetDao = new PrismaImageAssetDao({ database });
  const ithomeArticleDao = new PrismaIthomeArticleDao({ database });
  const ithomeFeedCursorDao = new PrismaIthomeFeedCursorDao({ database });
  const todoDao = new PrismaTodoDao({ database });
  const embeddingCacheDao = new PrismaEmbeddingCacheDao({ database });

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
  // server.oss 缺失即关闭图片存档（resid 恒为 null，只走 vision 文字描述，优雅降级）。
  const ossClient = config.server.oss
    ? new HttpOssClient({ baseUrl: config.server.oss.baseUrl })
    : undefined;
  const imageMessageAnalyzer = new DefaultNapcatImageMessageAnalyzer({
    visionAgent,
    ossClient,
    imageAssetDao,
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
    leadingWindowMs: config.server.agent.notificationLeadingWindowMs,
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
  const todoService = new TodoService({ todoDao });
  // 提醒/汇总以纯数据回调，draft 在这层（wiring 边界）构造并 push，capabilities 层不依赖 apps 层。
  const todoReminderPoller = new TodoReminderPoller({
    todoService,
    onDueReminder: reminder => {
      notificationCenter.push(new TodoReminderDraft(reminder));
    },
    onDigest: summary => {
      notificationCenter.push(new TodoDigestDraft(summary));
    },
  });
  // 手机 OS 模型：napcat 网关收纳进 QQ App。这里只把网关的协作者（持久化 / 图片分析 /
  // DAO + configManager）传进去，网关实例由 buildQqApp 构造并独占持有，入站事件直达
  // QqApp、不再走共享事件队列（也就不再需要跨边界的 late-bind holder）。
  const agentRuntime = await buildAgentRuntime({
    config,
    database,
    llmClient,
    embeddingClient,
    metricService,
    napcat: {
      configManager,
      persistenceWriter: napcatPersistenceWriter,
      imageMessageAnalyzer,
      qqMessageDao: napcatQqMessageDao,
    },
    ithomeService,
    todoService,
    notificationCenter,
    eventQueue,
    storyEventQueue,
    ossClient,
  });

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
  for (const task of buildTodoScheduledTasks({ todoReminderPoller })) {
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
      new StoryHandler({
        storyQueryService: agentRuntime.storyQueryService,
        storyReindexService: agentRuntime.storyReindexService,
      }),
      new NapcatHandler({ qqMessageSender: agentRuntime.qqOutboundService }),
      new SchedulerHandler({ taskScheduler }),
    ],
  });

  return {
    app,
    database,
    shutdownApps: agentRuntime.shutdownApps,
    taskScheduler,
    callbackServers: authModule.callbackServers,
    rootAgentRuntime: agentRuntime.rootAgentRuntime,
    storyAgentRuntime: agentRuntime.storyAgentRuntime,
    storyAgentEnabled: agentRuntime.storyAgentEnabled,
    metricService,
    port: config.server.port,
    listenGroupIds: config.server.napcat.listenGroupIds,
    startupContextRecentMessageCount: config.server.napcat.startupContextRecentMessageCount,
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
