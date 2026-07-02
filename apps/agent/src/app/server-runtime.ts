import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { InMemoryQueue } from "@kagami/agent-runtime";
import { DefaultConfigManager } from "@kagami/kernel/config/config.impl.manager";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import { configureSqlite, createDbClient, type Database } from "@kagami/persistence/db/client";
import { PrismaLogDao } from "@kagami/persistence/logger/dao/impl/log.impl.dao";
import { PrismaImageAssetDao } from "../napcat/infra/impl/image-asset.impl.dao.js";
import { PrismaNapcatEventDao } from "@kagami/persistence/dao/impl/napcat-event.impl.dao";
import { PrismaNapcatQqMessageDao } from "@kagami/persistence/dao/impl/napcat-group-message.impl.dao";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { toHttpErrorResponse } from "@kagami/kernel/errors/http-error";
import { MainAgentContextHandler } from "../ops/http/main-agent-context.handler.js";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { LlmHandler } from "../llm/http/llm.handler.js";
import { NapcatHandler } from "../napcat/http/napcat.handler.js";
import { HttpLlmClient } from "../llm/http-llm-client.js";
import type { LlmProviderOption } from "@kagami/llm-api/llm-chat";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { initLoggerRuntime, withTraceContext } from "@kagami/kernel/logger/runtime";
import { DbLogSink } from "@kagami/kernel/logger/sinks/db-sink";
import { StdoutLogSink } from "@kagami/kernel/logger/sinks/stdout-sink";
import type { Event } from "../agent/runtime/event/event.js";
import type { RootLoopAgent } from "../agent/runtime/root-agent/root-agent-runtime.js";
import { buildIthomeScheduledTasks } from "../agent/capabilities/ithome/application/ithome-scheduled-tasks.js";
import { TaskScheduler } from "../scheduler/application/task-scheduler.js";
import { buildDataRetentionTasks } from "../scheduler/tasks/data-retention/data-retention-task.factory.js";
import { SchedulerHandler } from "../scheduler/http/scheduler.handler.js";
import { NapcatEventPersistenceWriter } from "../napcat/application/napcat-gateway/event-persistence-writer.js";
import { DefaultNapcatImageMessageAnalyzer } from "../napcat/application/napcat-gateway/image-message-analyzer.js";
import { HttpOssClient } from "../oss/oss-client.js";
import { HttpBrowserClient } from "../browser/browser-client.js";
import { HttpSpireClient } from "../spire/spire-client.js";
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
import { TodoSuggestionService } from "../agent/capabilities/todo/application/todo-suggestion.service.js";
import { buildTodoScheduledTasks } from "../agent/capabilities/todo/application/todo-scheduled-tasks.js";
import { TodoReminderDraft } from "../agent/apps/todo/todo-reminder-draft.js";
import { TodoDigestDraft } from "../agent/apps/todo/todo-digest-draft.js";
import { NotificationCenter } from "../agent/runtime/root-agent/notification/notification-center.js";
import type { MetricService } from "../metric/application/metric.service.js";
import { HttpMetricService } from "../metric/application/metric.impl.service.js";
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
  metricService: MetricService;
  port: number;
  listenGroupIds: string[];
  startupContextRecentMessageCount: number;
  hasTavilyApiKey: boolean;
  /**
   * LLM provider 生命周期已随 kagami-llm 服务外移；agent 进程不再持有 provider，这里恒为 no-op。
   * 保留字段以免动 index/server-shutdown 的关停编排（它们对空/no-op 天然无害）。
   */
  closeLlmProviders: () => Promise<void>;
  listAvailableAgentProviders: () => Promise<LlmProviderOption[]>;
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
  // metric 打点改走独立 metric 服务（@kagami/metric）的 HTTP 摄取端点；地址取自 services.metric。
  const metricService = new HttpMetricService({
    baseUrl: `http://${config.services.metric.host}:${config.services.metric.port}`,
  });
  initLoggerRuntime({
    sinks: [new StdoutLogSink(), new DbLogSink({ logDao })],
  });

  const napcatEventDao = new PrismaNapcatEventDao({ database });
  const napcatQqMessageDao = new PrismaNapcatQqMessageDao({ database });
  const imageAssetDao = new PrismaImageAssetDao({ database });
  const ithomeArticleDao = new PrismaIthomeArticleDao({ database });
  const ithomeFeedCursorDao = new PrismaIthomeFeedCursorDao({ database });
  const todoDao = new PrismaTodoDao({ database });

  // LLM provider + OAuth 凭据中心已外移到独立 kagami-llm 进程（issue：多 Agent 共享网关）。
  // agent 经 HttpLlmClient 直连它（地址从顶层 services.llm 派生），实现现有 LlmClient
  // 接口——下游 root-agent/vision/... 零改动。llm_chat_call 落库、auth callback/刷新全在
  // 服务侧，agent 不再碰。embedding 能力也在服务侧（将来记忆系统接线时按需在 agent 侧新建 client）。
  const llmServiceBaseUrl = `http://${config.services.llm.host}:${config.services.llm.port}`;
  const llmClient = new HttpLlmClient({ baseUrl: llmServiceBaseUrl });
  const visionAgent = new VisionAgent({
    llmClient,
  });
  // server.oss 缺失/禁用即关闭图片存档（resid 恒为 null，只走 vision 文字描述，优雅降级）。
  // 启用时地址统一从顶层 services.oss 派生（host 是 reachable host，agent 据此 PUT）。
  const ossClient = config.server.oss?.enabled
    ? new HttpOssClient({
        baseUrl: `http://${config.services.oss.host}:${config.services.oss.port}`,
      })
    : undefined;
  // 浏览器拆成独立 kagami-browser 进程（issue #173）：agent 经 HTTP client 调它，地址
  // 从顶层 services.browser 派生（host 是 reachable host）。浏览器进程未起时，client
  // 把错误归一成 BROWSER_NOT_READY，工具仍回规整失败结构。
  const browserClient = new HttpBrowserClient({
    baseUrl: `http://${config.services.browser.host}:${config.services.browser.port}`,
  });
  // 尖塔卡牌游戏拆成独立 kagami-spire 进程（issue #234）：agent 经 HTTP client 调它，地址从
  // 顶层 services.spire 派生。游戏进程未起时，client 把错误归一成 SPIRE_NOT_READY，工具仍回规整失败结构。
  const spireClient = new HttpSpireClient({
    baseUrl: `http://${config.services.spire.host}:${config.services.spire.port}`,
  });
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
  // 手机 OS 模型：napcat 网关收纳进 QQ App。这里只把网关的协作者（持久化 / 图片分析 /
  // DAO + configManager）传进去，网关实例由 buildQqApp 构造并独占持有，入站事件直达
  // QqApp、不再走共享事件队列（也就不再需要跨边界的 late-bind holder）。
  const agentRuntime = await buildAgentRuntime({
    config,
    database,
    llmClient,
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
    ossClient,
    browserClient,
    spireClient,
  });

  // TodoReminderPoller 构造放在 agentRuntime 之后：digest 第三段要 fork 主 Agent 上下文，
  // 依赖 agentRuntime.rootAgentRuntime.getContextSnapshot()。reminder-tick 路径不依赖它，故安全。
  // 提醒/汇总以纯数据回调，draft 在这层（wiring 边界）构造并 push，capabilities 层不依赖 apps 层。
  const todoSuggestionService = new TodoSuggestionService({
    // 工具装配与主 Agent 字节相等的 task agent（见 agent-runtime.factory），
    // propose_todos 经 invoke 终止子工具提交，不新增顶层工具。
    taskAgent: agentRuntime.todoSuggestionTaskAgent,
  });
  const suggestTodos = async (openTodos: { title: string }[]): Promise<string[]> => {
    try {
      const snapshot = await agentRuntime.rootAgentRuntime.getContextSnapshot();
      // snapshot.messages 已由 getSnapshot 深克隆（且此快照无人共享），service 只做只读 spread，
      // 无需再克隆一次。
      return await todoSuggestionService.propose({
        systemPrompt: snapshot.systemPrompt,
        messages: snapshot.messages,
        openTodos,
      });
    } catch {
      // fork 主上下文本身出错（快照失败等）：digest 降级为只发前两段。
      return [];
    }
  };
  const todoReminderPoller = new TodoReminderPoller({
    todoService,
    onDueReminder: reminder => {
      notificationCenter.push(new TodoReminderDraft(reminder));
    },
    onDigest: (summary, suggestions) => {
      notificationCenter.push(new TodoDigestDraft({ ...summary, suggestions }));
    },
    suggestTodos,
  });

  // auth 刷新 + usage 刷新已随 kagami-llm 服务外移（在服务进程用自己的 timer 驱动）；
  // agent 的 TaskScheduler 只剩 ithome / todo / data-retention 任务。
  const taskScheduler = new TaskScheduler();
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
      new LlmHandler({ llmPlaygroundService: agentRuntime.llmPlaygroundService }),
      new MainAgentContextHandler({
        mainAgentContextQueryService: agentRuntime.mainAgentContextQueryService,
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
    // OAuth callback server 随 kagami-llm 服务外移；agent 不再持有，关停编排对空数组无害。
    callbackServers: [],
    rootAgentRuntime: agentRuntime.rootAgentRuntime,
    metricService,
    port: config.services.agent.port,
    listenGroupIds: config.server.napcat.listenGroupIds,
    startupContextRecentMessageCount: config.server.napcat.startupContextRecentMessageCount,
    hasTavilyApiKey: agentRuntime.hasTavilyApiKey,
    // provider 生命周期在 kagami-llm 服务侧；agent 无本地 provider 可关，no-op。
    closeLlmProviders: async () => {},
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
