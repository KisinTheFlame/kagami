import {
  AppManager,
  AsyncTaskManager,
  createAppSubtoolOwner,
  HELP_TOOL_NAME,
  HelpTool,
  OutOfScopeTool,
  ToolCatalog,
  type Queue,
  type ToolComponent,
} from "@kagami/agent-runtime";
import { createWebSearchSubtoolOwner } from "../agent/capabilities/web-search/task-agent/web-search-subtool-owner.js";
import type { Config } from "@kagami/kernel/config/config.loader";
import type { Database } from "@kagami/persistence/db/client";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { LlmClient } from "../llm/client.js";
import type { EmbeddingClient } from "../llm/embedding/client.js";
import { DefaultLlmPlaygroundService } from "../llm/application/llm-playground.impl.service.js";
import type { LlmPlaygroundService } from "../llm/application/llm-playground.service.js";
import type { MetricService } from "../metric/application/metric.service.js";
import type { ConfigManager } from "@kagami/kernel/config/config.manager";
import type { NapcatQqMessageDao } from "@kagami/persistence/dao/napcat-group-message.dao";
import type { NapcatGatewayPersistenceWriter } from "../napcat/application/napcat-gateway/event-persistence-writer.js";
import type { NapcatImageMessageAnalyzer } from "../napcat/application/napcat-gateway/image-message-analyzer.js";
import type { AgentMessageService } from "../agent/capabilities/messaging/application/agent-message.service.js";
import type { IthomeService } from "../agent/capabilities/ithome/application/ithome.service.js";
import type { StoryQueryService } from "../ops/application/story-query.service.js";
import type { StoryReindexService } from "../ops/application/story-reindex.service.js";
import type { MainAgentContextQueryService } from "../ops/application/main-agent-context-query.service.js";
import { DefaultStoryQueryService } from "../ops/application/story-query.impl.service.js";
import { DefaultStoryReindexService } from "../ops/application/story-reindex.impl.service.js";
import { DefaultMainAgentContextQueryService } from "../ops/application/main-agent-context-query.impl.service.js";
import { DefaultAgentContext } from "../agent/runtime/context/default-agent-context.js";
import { LinearMessageLedgerAgentContext } from "../agent/runtime/context/linear-message-ledger-agent-context.js";
import type { Event } from "../agent/runtime/event/event.js";
import type { StoryAgentEvent } from "../agent/capabilities/story/runtime/story-event.js";
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
import { SwitchTool, SWITCH_TOOL_NAME } from "../agent/runtime/root-agent/tools/switch.tool.js";
import { InvokeTool, INVOKE_TOOL_NAME } from "../agent/runtime/root-agent/tools/invoke.tool.js";
import { WaitTool, WAIT_TOOL_NAME } from "../agent/runtime/root-agent/tools/wait.tool.js";
import {
  createRootContextSummaryReminderMessage,
  createStoryContextSummaryReminderMessage,
} from "../agent/runtime/context/context-message-factory.js";
import { TavilyWebSearchService } from "../agent/capabilities/web-search/application/tavily-web-search.service.js";
import { SearchWebRawTool } from "../agent/capabilities/web-search/task-agent/tools/search-web-raw.tool.js";
import { FinalizeWebSearchTool } from "../agent/capabilities/web-search/task-agent/tools/finalize-web-search.tool.js";
import { WebSearchTaskAgent } from "../agent/capabilities/web-search/task-agent/web-search-task-agent.js";
import {
  createSearchWebTool,
  SEARCH_WEB_TOOL_NAME,
} from "../agent/capabilities/web-search/tools/search-web.tool.js";
import { ContextSummaryOperation } from "../agent/capabilities/context-summary/operations/context-summary.operation.js";
import {
  SummaryTool,
  SUMMARY_TOOL_NAME,
} from "../agent/capabilities/context-summary/tools/summary.tool.js";
import { PrismaTerminalStateDao } from "../agent/capabilities/terminal/infra/prisma-terminal-state.dao.js";
import { PrismaTerminalOutputDao } from "../agent/capabilities/terminal/infra/prisma-terminal-output.dao.js";
import { TerminalApp } from "../agent/apps/terminal/terminal.app.js";
import { IthomeApp } from "../agent/apps/ithome/ithome.app.js";
import { BrowserApp } from "../agent/apps/browser/browser.app.js";
import type { BrowserClient } from "../browser/browser-client.js";
import { TodoApp } from "../agent/apps/todo/todo.app.js";
import type { TodoService } from "../agent/capabilities/todo/application/todo.service.js";
import { PrismaLinearMessageLedgerDao } from "../agent/capabilities/story/infra/impl/prisma-linear-message-ledger.impl.dao.js";
import { PrismaStoryDao } from "../agent/capabilities/story/infra/impl/prisma-story.impl.dao.js";
import { PrismaStoryMemoryDocumentDao } from "../agent/capabilities/story/infra/impl/prisma-story-memory-document.impl.dao.js";
import { HnswVectorIndex } from "../agent/capabilities/story/infra/hnsw-vector-index.js";
import { PrismaStoryAgentRuntimeSnapshotRepository } from "../agent/capabilities/story/runtime/persistence/prisma-story-agent-runtime-snapshot.repository.js";
import { StoryMemoryIndexService } from "../agent/capabilities/story/application/story-memory-index.service.js";
import { StoryRecallService } from "../agent/capabilities/story/application/story-recall.service.js";
import { StoryService } from "../agent/capabilities/story/application/story.service.js";
import { StoryLoopAgent } from "../agent/capabilities/story/runtime/story-agent.runtime.js";
import { StoryRecallExtension } from "../agent/capabilities/story/runtime/story-recall.extension.js";
import { StoryRecallScheduler } from "../agent/capabilities/story/runtime/story-recall.scheduler.js";
import {
  SearchMemoryTool,
  SEARCH_MEMORY_TOOL_NAME,
} from "../agent/capabilities/story/tools/search-memory.tool.js";
import { ResourceService } from "../agent/capabilities/resource/application/resource.service.js";
import { ResourceFileService } from "../agent/capabilities/resource/application/resource-file.service.js";
import {
  ReadResourceTool,
  READ_RESOURCE_TOOL_NAME,
} from "../agent/capabilities/resource/tools/read-resource.tool.js";
import {
  DownloadResourceTool,
  DOWNLOAD_RESOURCE_TOOL_NAME,
} from "../agent/capabilities/resource/tools/download-resource.tool.js";
import {
  UploadResourceTool,
  UPLOAD_RESOURCE_TOOL_NAME,
} from "../agent/capabilities/resource/tools/upload-resource.tool.js";
import type { OssClient } from "../oss/oss-client.js";
import { CalcApp } from "../agent/apps/calc/calc.app.js";
import { ClockApp } from "../agent/apps/clock/clock.app.js";
import { HnApp } from "../agent/apps/hn/hn.app.js";
import { AmapApp } from "../agent/apps/amap/amap.app.js";
import type { QqApp } from "../agent/apps/qq/qq.app.js";
import { buildQqApp } from "../agent/apps/qq/qq-app.factory.js";
import { PrismaAppStateStore } from "../agent/runtime/app-state/prisma-app-state-store.js";
import type { NotificationCenter } from "../agent/runtime/root-agent/notification/notification-center.js";

const logger = new AppLogger({ source: "agent.runtime-factory" });

/**
 * napcat 网关的协作者（组合根构造后注入）。网关本身在 buildQqApp 内构造、归 QQ App 持有；
 * 这些是跨切面基础设施：持久化写入器 + 图片分析 + 消息 DAO（DAO 同时被 ops 查询侧读）。
 */
type NapcatGatewayDeps = {
  configManager: ConfigManager;
  persistenceWriter: NapcatGatewayPersistenceWriter;
  imageMessageAnalyzer: NapcatImageMessageAnalyzer;
  qqMessageDao: NapcatQqMessageDao;
};

type BuildAgentRuntimeInput = {
  config: Config;
  database: Database;
  llmClient: LlmClient;
  embeddingClient: EmbeddingClient;
  metricService: MetricService;
  napcat: NapcatGatewayDeps;
  ithomeService: IthomeService;
  todoService: TodoService;
  notificationCenter: NotificationCenter;
  eventQueue: Queue<Event>;
  storyEventQueue: Queue<StoryAgentEvent>;
  /** 自建对象存储客户端；缺省（server.oss 未配）时资源读取/发送/截图落 OSS 优雅降级。 */
  ossClient?: OssClient;
  /** 浏览器动作客户端：打到独立的 kagami-browser 进程（issue #173）。 */
  browserClient: BrowserClient;
};

export type AgentRuntimeBundle = {
  rootAgentRuntime: RootLoopAgent;
  storyAgentRuntime: StoryLoopAgent;
  /** Story Agent 后台 loop 是否启用；false 时不 initialize/run、不消费 ledger 事件。 */
  storyAgentEnabled: boolean;
  storyQueryService: StoryQueryService;
  storyReindexService: StoryReindexService;
  mainAgentContextQueryService: MainAgentContextQueryService;
  llmPlaygroundService: LlmPlaygroundService;
  hasTavilyApiKey: boolean;
  /** QQ App：手机 OS 模型下聊天的承载者，已收纳 napcat 网关（自管生命周期 + 入站事件）。 */
  qqApp: QqApp;
  /** QQ 出站发送端口（收口）：管理台直发 HTTP 走这里，不碰裸网关。 */
  qqOutboundService: AgentMessageService;
  /** 反序关停所有 App 的 onShutdown（含 QQ App 停网关）。由服务关停链调用。 */
  shutdownApps: () => Promise<void>;
};

export async function buildAgentRuntime({
  config,
  database,
  llmClient,
  embeddingClient,
  metricService,
  napcat,
  ithomeService,
  todoService,
  notificationCenter,
  eventQueue,
  storyEventQueue,
  ossClient,
  browserClient,
}: BuildAgentRuntimeInput): Promise<AgentRuntimeBundle> {
  const rootAgentRuntimeSnapshotRepository = new PrismaRootAgentRuntimeSnapshotRepository({
    database,
  });
  const storyAgentRuntimeSnapshotRepository = new PrismaStoryAgentRuntimeSnapshotRepository({
    database,
  });
  const linearMessageLedgerDao = new PrismaLinearMessageLedgerDao({ database });
  const storyDao = new PrismaStoryDao({ database });
  const storyVectorIndex = await buildStoryVectorIndex({ config, database });
  const storyMemoryDocumentDao = new PrismaStoryMemoryDocumentDao({
    database,
    vectorIndex: storyVectorIndex,
  });
  const storyMemoryIndexService = new StoryMemoryIndexService({
    storyMemoryDocumentDao,
    embeddingClient,
    outputDimensionality: config.server.agent.story.memory.embedding.outputDimensionality,
  });
  const storyService = new StoryService({
    storyDao,
    storyMemoryIndexService,
  });
  const storyRecallService = new StoryRecallService({
    storyMemoryDocumentDao,
    storyDao,
    embeddingClient,
    embeddingModel: config.server.agent.story.memory.embedding.model,
    outputDimensionality: config.server.agent.story.memory.embedding.outputDimensionality,
  });
  const storyQueryService = new DefaultStoryQueryService({
    storyDao,
    storyRecallService,
  });
  const storyReindexService = new DefaultStoryReindexService({
    storyDao,
    storyMemoryDocumentDao,
    storyMemoryIndexService,
    embeddingModel: config.server.agent.story.memory.embedding.model,
    outputDimensionality: config.server.agent.story.memory.embedding.outputDimensionality,
  });

  const webSearchService = new TavilyWebSearchService({
    apiKey: config.server.tavily.apiKey,
  });
  // 网页搜索 task agent 自己的子工具：search_web_raw 和 finalize_web_search。
  // 它们被一个独立的 webSearchSubtoolOwner 持有，挂在 WebSearchTaskAgent 自己
  // 的 InvokeTool 实例上；主 Agent 视野永远看不到它们。
  const webSearchSubtools: ToolComponent[] = [
    new SearchWebRawTool({ webSearchService }),
    new FinalizeWebSearchTool(),
  ];
  const webSearchInvokeTool = new InvokeTool({
    owners: [createWebSearchSubtoolOwner({ tools: webSearchSubtools })],
  });

  // WebSearchTaskAgent 的 taskTools 需要等到主 Agent rootAgentTools 装配完才能
  // 拼出来（要拿 enter / back / wait / search_web / search_memory / help 等
  // 主 Agent 顶层工具实例，包成 OutOfScopeTool）。这里先打一个延迟引用，等下
  // 面真实 webSearchTaskAgent 构造好再回填。SearchWebTool 调用时通过这个 ref
  // 转发——执行时 webSearchTaskAgent 必然已经就位。
  const webSearchTaskAgentRef: { current: WebSearchTaskAgent | undefined } = {
    current: undefined,
  };
  const webSearchTaskAgentInvoker = {
    invoke: async (input: Parameters<WebSearchTaskAgent["invoke"]>[0]) => {
      const taskAgent = webSearchTaskAgentRef.current;
      if (!taskAgent) {
        throw new Error("WebSearchTaskAgent 尚未装配完成，不能调用");
      }
      return await taskAgent.invoke(input);
    },
  };
  const terminalStateDao = new PrismaTerminalStateDao({ database });
  const terminalOutputDao = new PrismaTerminalOutputDao({ database });

  // 资源读取层：read_resource（全局工具）与 send_resource（QQ 子工具）共用。OSS 关闭时
  // 调用层报错，构造本身不依赖 OSS 在线。
  const resourceService = new ResourceService({
    ossClient,
    maxBytes: config.server.agent.resource.maxBytes,
  });
  // 资源本地文件桥：download_resource / upload_resource 全局工具共用。落盘/读盘锚定
  // fileRoot 沙箱，字节走 fileMaxBytes（独立于上下文 cap）。OSS 关时调用层报错。
  const resourceFileService = new ResourceFileService({
    ossClient,
    fileRoot: config.server.agent.resource.fileRoot,
    fileMaxBytes: config.server.agent.resource.fileMaxBytes,
  });

  // QQ App 装配：手机 OS 模型下聊天的承载者，已「收纳」napcat 网关——网关在 buildQqApp
  // 内构造并由 QqApp 独占持有，入站事件直达 handleNapcatEvent（不走共享事件队列），出站
  // 统一走 outboundService（收口）。这里不再见到裸网关。
  const { qqApp, outboundService: qqOutboundService } = await buildQqApp({
    configManager: napcat.configManager,
    persistenceWriter: napcat.persistenceWriter,
    imageMessageAnalyzer: napcat.imageMessageAnalyzer,
    qqMessageDao: napcat.qqMessageDao,
    notificationCenter,
    botQQ: config.server.bot.qq,
    listenGroupIds: config.server.napcat.listenGroupIds,
    recentMessageLimit: config.server.napcat.startupContextRecentMessageCount,
    aiTone: {
      enabled: config.server.agent.messaging.aiTone.enabled,
      blockThreshold: config.server.agent.messaging.aiTone.blockThreshold,
    },
    resourceService,
  });

  // App 框架：先建 AppManager 并注册 Apps，再按各 App 的 configSchema 校验
  // config.server.apps 切片并 onStartup；createAppSubtoolOwner 在内部摊平 App 工具
  // 挂到主 Agent 的 InvokeTool 上。注入 App 状态持久化能力：startup 时恢复、shutdown
  // 时存档各 App 自己的状态（如 QQ 未读红点），走 app_state 通用表。
  const appManager = new AppManager({
    stateStore: new PrismaAppStateStore({ database }),
  });
  appManager.register(new CalcApp());
  appManager.register(new TerminalApp({ terminalStateDao, terminalOutputDao }));
  appManager.register(new IthomeApp({ ithomeService }));
  appManager.register(new TodoApp({ todoService }));
  appManager.register(new ClockApp());
  appManager.register(new HnApp());
  appManager.register(new AmapApp({ ossClient }));
  appManager.register(new BrowserApp({ browserClient, ossClient }));
  appManager.register(qqApp);
  await appManager.startupAll(config.server.apps);

  const agentSystemPromptFactory = async () => {
    return createAgentSystemPrompt({
      botQQ: config.server.bot.qq,
      creatorName: config.server.bot.creator.name,
      creatorQQ: config.server.bot.creator.qq,
    });
  };
  // Story Agent（后台故事写作 loop）可通过 config.server.agent.story.enabled 整体关停。
  // 关停时：不运行后台 loop，且不再向 storyEventQueue 入队（否则 ledger_appended 事件
  // 会在无人消费下无界堆积）。这与主 Agent 前缀完全无关——search_memory 顶层工具照旧
  // 注册、tools 列表字节不变，KV 缓存与稳定前缀不受任何影响。
  const storyAgentEnabled = config.server.agent.story.enabled;
  const context = new LinearMessageLedgerAgentContext({
    inner: new DefaultAgentContext({
      systemPromptFactory: agentSystemPromptFactory,
    }),
    linearMessageLedgerDao,
    runtimeKey: ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
    onLedgerAppended: count => {
      if (!storyAgentEnabled) {
        return;
      }
      storyEventQueue.enqueue({ type: "ledger_appended", count });
    },
  });
  const rootAgentSession = new RootAgentSession({
    context,
    appManager,
  });
  const helpTool = new HelpTool({
    appManager,
    getCurrentApp: () => rootAgentSession.getCurrentApp(),
  });
  // 主 Agent 的 invoke 子工具所有者：全部 App 工具（含 QQ 的 send_message）由
  // AppManager 把握所有权与 gate。状态树时代的 owner 已退役。
  const mainSubtoolOwners = [
    createAppSubtoolOwner({
      appManager,
      getCurrentApp: () => rootAgentSession.getCurrentApp(),
    }),
  ];

  // 主 Agent 的顶层工具实例。WebSearchTaskAgent 之后会复用这些实例的 llmTool
  // 定义（通过 OutOfScopeTool 包一层），保证两个 agent 暴露给 LLM 的 tools
  // 字段字节相等，命中 KV cache。
  const enterTool = new EnterTool({ appManager });
  const backToPortalTool = new BackToPortalTool({ appManager });
  const switchTool = new SwitchTool({ appManager });
  const waitTool = new WaitTool({
    maxWaitMs: config.server.agent.waitToolMaxWaitMs,
  });
  const mainInvokeTool = new InvokeTool({ owners: mainSubtoolOwners });
  // 异步工具原语：在飞任务跑完/超时通过 onComplete 把结果以事件回流给主 Agent，
  // session 路由后追加成 <async_tool_result> 消息并触发新一轮。首个消费者是 search_web。
  const asyncTaskManager = new AsyncTaskManager({
    maxTaskDurationMs: config.server.agent.asyncTask.maxTaskDurationMs,
    onComplete: completion =>
      eventQueue.enqueue({ type: "async_tool_result_completed", data: completion }),
  });
  const searchWebTool = createSearchWebTool({
    webSearchTaskAgent: webSearchTaskAgentInvoker,
    asyncTaskManager,
  });
  const searchMemoryTool = new SearchMemoryTool({
    storyRecallService,
    topK: config.server.agent.story.memory.retrieval.topK,
  });
  const readResourceTool = new ReadResourceTool({ resourceService });
  const downloadResourceTool = new DownloadResourceTool({ resourceFileService });
  const uploadResourceTool = new UploadResourceTool({ resourceFileService });
  const summaryTool = new SummaryTool();
  const toolCatalog = new ToolCatalog([
    enterTool,
    backToPortalTool,
    switchTool,
    waitTool,
    mainInvokeTool,
    searchWebTool,
    searchMemoryTool,
    readResourceTool,
    downloadResourceTool,
    uploadResourceTool,
    summaryTool,
    helpTool,
  ]);
  const rootAgentTools = toolCatalog.pick([
    ENTER_TOOL_NAME,
    BACK_TO_PORTAL_TOOL_NAME,
    SWITCH_TOOL_NAME,
    WAIT_TOOL_NAME,
    INVOKE_TOOL_NAME,
    SEARCH_WEB_TOOL_NAME,
    SEARCH_MEMORY_TOOL_NAME,
    READ_RESOURCE_TOOL_NAME,
    DOWNLOAD_RESOURCE_TOOL_NAME,
    UPLOAD_RESOURCE_TOOL_NAME,
    HELP_TOOL_NAME,
  ]);

  // WebSearchTaskAgent 看到的顶层工具集：和主 Agent 一字不差（同样 9 个工具的
  // name / description / parameters / llmTool），但执行语义完全隔离——
  //  - invoke 换成 webSearchInvokeTool（owner = webSearchSubtoolOwner，只识别
  //    search_web_raw / finalize_web_search）
  //  - 其余 8 个顶层工具用 OutOfScopeTool 软包，调到就返回 OUT_OF_SCOPE 错误，
  //    不会真的改主 Agent 的 session / 触发嵌套搜索
  // 这是 prompt cache 字节相等 + 行为隔离的关键搭配。
  const webSearchAgentToolCatalog = new ToolCatalog([
    new OutOfScopeTool({
      inner: enterTool,
      reason:
        '在网页搜索子任务中不可调用 enter。请用 invoke(tool="search_web_raw", ...) 检索，必要时反复，信息足够后用 invoke(tool="finalize_web_search", summary=...) 输出最终摘要。',
    }),
    new OutOfScopeTool({
      inner: backToPortalTool,
      reason: "在网页搜索子任务中不可调用 back_to_portal。",
    }),
    new OutOfScopeTool({
      inner: switchTool,
      reason: "在网页搜索子任务中不可调用 switch。",
    }),
    new OutOfScopeTool({
      inner: waitTool,
      reason: "在网页搜索子任务中不可调用 wait。",
    }),
    webSearchInvokeTool,
    new OutOfScopeTool({
      inner: searchWebTool,
      reason: "网页搜索子任务内禁止再次调用 search_web，否则会无限嵌套。",
    }),
    new OutOfScopeTool({
      inner: searchMemoryTool,
      reason: "在网页搜索子任务中不可调用 search_memory。",
    }),
    new OutOfScopeTool({
      inner: readResourceTool,
      reason: "在网页搜索子任务中不可调用 read_resource。",
    }),
    new OutOfScopeTool({
      inner: downloadResourceTool,
      reason: "在网页搜索子任务中不可调用 download_resource。",
    }),
    new OutOfScopeTool({
      inner: uploadResourceTool,
      reason: "在网页搜索子任务中不可调用 upload_resource。",
    }),
    new OutOfScopeTool({
      inner: helpTool,
      reason: "在网页搜索子任务中不可调用 help。",
    }),
  ]);
  const webSearchAgentTools = webSearchAgentToolCatalog.pick([
    ENTER_TOOL_NAME,
    BACK_TO_PORTAL_TOOL_NAME,
    SWITCH_TOOL_NAME,
    WAIT_TOOL_NAME,
    INVOKE_TOOL_NAME,
    SEARCH_WEB_TOOL_NAME,
    SEARCH_MEMORY_TOOL_NAME,
    READ_RESOURCE_TOOL_NAME,
    DOWNLOAD_RESOURCE_TOOL_NAME,
    UPLOAD_RESOURCE_TOOL_NAME,
    HELP_TOOL_NAME,
  ]);

  // 现在所有依赖都就位了，真正构造 WebSearchTaskAgent 并回填 ref。
  webSearchTaskAgentRef.current = new WebSearchTaskAgent({
    llmClient,
    taskTools: webSearchAgentTools,
  });
  const summaryToolExecutor = toolCatalog.pick([SUMMARY_TOOL_NAME]);
  const rootContextSummaryOperation = new ContextSummaryOperation({
    llmClient,
    summaryToolExecutor,
    reminderMessageFactory: createRootContextSummaryReminderMessage,
  });
  const storyContextSummaryOperation = new ContextSummaryOperation({
    llmClient,
    summaryToolExecutor,
    reminderMessageFactory: createStoryContextSummaryReminderMessage,
  });
  const storyAgentRuntime = new StoryLoopAgent({
    llmClient,
    linearMessageLedgerDao,
    snapshotRepository: storyAgentRuntimeSnapshotRepository,
    storyService,
    contextSummaryOperation: storyContextSummaryOperation,
    summaryTools: summaryToolExecutor.definitions(),
    contextCompactionTotalTokenThreshold: config.server.agent.contextCompactionTotalTokenThreshold,
    batchSize: config.server.agent.story.batchSize,
    idleFlushMs: config.server.agent.story.idleFlushMs,
    metricService,
    llmRetryBackoffMs: config.server.agent.llmRetryBackoffMs,
    sourceRuntimeKey: ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
    eventQueue: storyEventQueue,
  });
  if (!storyAgentEnabled) {
    logger.info("Story agent disabled by config", {
      event: "agent.story.disabled",
    });
  }
  // Story Recall Agent（后台自动召回）可通过配置整体关停。关停时只是不注册这个
  // loop extension —— search_memory 工具仍然保留在顶层工具集里，主 Agent 暴露给
  // LLM 的 tools 列表字节不变，稳定前缀与 KV 缓存完全不受影响。
  const storyRecallExtensions: StoryRecallExtension[] = [];
  if (config.server.agent.story.recall.enabled) {
    const storyRecallScheduler = new StoryRecallScheduler({
      llmClient,
      storyRecallService,
      agentContext: context,
      eventQueue,
      availableTools: rootAgentTools.definitions(),
      topK: config.server.agent.story.recall.topK,
      scoreThreshold: config.server.agent.story.recall.scoreThreshold,
    });
    storyRecallExtensions.push(new StoryRecallExtension({ scheduler: storyRecallScheduler }));
  } else {
    logger.info("Story recall agent disabled by config", {
      event: "agent.story_recall.disabled",
    });
  }
  const rootAgentRuntime = new RootLoopAgent({
    llmClient,
    context,
    eventQueue,
    session: rootAgentSession,
    snapshotRepository: rootAgentRuntimeSnapshotRepository,
    tools: rootAgentTools,
    contextSummaryOperation: rootContextSummaryOperation,
    contextCompactionTotalTokenThreshold: config.server.agent.contextCompactionTotalTokenThreshold,
    metricService,
    llmRetryBackoffMs: config.server.agent.llmRetryBackoffMs,
    loopExtensions: storyRecallExtensions,
    summaryTools: [
      ...rootAgentTools.definitions(),
      ...toolCatalog.pick([SUMMARY_TOOL_NAME]).definitions(),
    ],
  });

  const restoredSnapshot = await rootAgentRuntimeSnapshotRepository.load(
    ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  );
  if (restoredSnapshot) {
    await rootAgentRuntime.restorePersistedSnapshot(restoredSnapshot);
  }

  const llmPlaygroundService = new DefaultLlmPlaygroundService({
    llmClient,
    playgroundToolDefinitions: toolCatalog
      .pick([
        ENTER_TOOL_NAME,
        WAIT_TOOL_NAME,
        INVOKE_TOOL_NAME,
        SEARCH_WEB_TOOL_NAME,
        SEARCH_MEMORY_TOOL_NAME,
        READ_RESOURCE_TOOL_NAME,
        BACK_TO_PORTAL_TOOL_NAME,
        SWITCH_TOOL_NAME,
        HELP_TOOL_NAME,
        SUMMARY_TOOL_NAME,
      ])
      .definitions(),
  });
  const mainAgentContextQueryService = new DefaultMainAgentContextQueryService({
    rootAgentRuntime,
  });

  return {
    rootAgentRuntime,
    storyAgentRuntime,
    storyAgentEnabled,
    storyQueryService,
    storyReindexService,
    mainAgentContextQueryService,
    llmPlaygroundService,
    hasTavilyApiKey: Boolean(config.server.tavily.apiKey),
    qqApp,
    qqOutboundService,
    shutdownApps: () => appManager.shutdownAll(),
  };
}

/**
 * 创建 Story 向量索引并完成启动补水：从 SQLite 读出全部归一化向量，重建进程内 HNSW。
 * SQLite 是事实来源，索引文件只是派生快照，因此每次启动都重建，不依赖磁盘上的旧索引。
 */
async function buildStoryVectorIndex({
  config,
  database,
}: {
  config: Config;
  database: Database;
}): Promise<HnswVectorIndex> {
  const vectorIndex = new HnswVectorIndex({
    dimensions: config.server.agent.story.memory.embedding.outputDimensionality,
    indexFilePath: config.server.agent.story.memory.vectorIndexPath,
  });

  const rows = await database.storyMemoryDocument.findMany({
    where: { embedding: { not: null } },
    select: { id: true, embedding: true },
  });

  const points = rows
    .map(row => ({ label: row.id, vector: parseEmbedding(row.embedding) }))
    .filter(point => point.vector.length > 0);
  vectorIndex.rebuildFrom(points);

  return vectorIndex;
}

function parseEmbedding(value: string | null): number[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(item => Number(item)) : [];
  } catch {
    return [];
  }
}
