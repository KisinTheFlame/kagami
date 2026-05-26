import {
  AppManager,
  createAppSubtoolOwner,
  HELP_TOOL_NAME,
  HelpTool,
  OutOfScopeTool,
  ToolCatalog,
  type Queue,
  type ToolComponent,
} from "@kagami/agent-runtime";
import { createStateTreeSubtoolOwner } from "../agent/runtime/root-agent/tools/state-tree-subtool-owner.js";
import { createWebSearchSubtoolOwner } from "../agent/capabilities/web-search/task-agent/web-search-subtool-owner.js";
import type { Config } from "../config/config.loader.js";
import type { Database } from "../db/client.js";
import type { LlmClient } from "../llm/client.js";
import type { EmbeddingClient } from "../llm/embedding/client.js";
import { DefaultLlmPlaygroundService } from "../llm/application/llm-playground.impl.service.js";
import type { LlmPlaygroundService } from "../llm/application/llm-playground.service.js";
import type { MetricService } from "../metric/application/metric.service.js";
import type { NapcatGatewayService } from "../napcat/service/napcat-gateway.service.js";
import type { IthomeNewsService } from "../news/application/ithome-news.service.js";
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
import { BackTool, BACK_TOOL_NAME } from "../agent/runtime/root-agent/tools/back.tool.js";
import {
  BackToPortalTool,
  BACK_TO_PORTAL_TOOL_NAME,
} from "../agent/runtime/root-agent/tools/back-to-portal.tool.js";
import { EnterTool, ENTER_TOOL_NAME } from "../agent/runtime/root-agent/tools/enter.tool.js";
import { InvokeTool, INVOKE_TOOL_NAME } from "../agent/runtime/root-agent/tools/invoke.tool.js";
import { WaitTool, WAIT_TOOL_NAME } from "../agent/runtime/root-agent/tools/wait.tool.js";
import {
  createRootContextSummaryReminderMessage,
  createStoryContextSummaryReminderMessage,
} from "../agent/runtime/context/context-message-factory.js";
import { DefaultAgentMessageService } from "../agent/capabilities/messaging/application/default-agent-message.service.js";
import { SendMessageTool } from "../agent/capabilities/messaging/tools/send-message.tool.js";
import { TavilyWebSearchService } from "../agent/capabilities/web-search/application/tavily-web-search.service.js";
import { SearchWebRawTool } from "../agent/capabilities/web-search/task-agent/tools/search-web-raw.tool.js";
import { FinalizeWebSearchTool } from "../agent/capabilities/web-search/task-agent/tools/finalize-web-search.tool.js";
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
import { PrismaTerminalStateDao } from "../agent/capabilities/terminal/infra/prisma-terminal-state.dao.js";
import { PrismaTerminalOutputDao } from "../agent/capabilities/terminal/infra/prisma-terminal-output.dao.js";
import { TerminalApp } from "../agent/apps/terminal/terminal.app.js";
import { IthomeApp } from "../agent/apps/ithome/ithome.app.js";
import { PrismaLinearMessageLedgerDao } from "../agent/capabilities/story/infra/impl/prisma-linear-message-ledger.impl.dao.js";
import { PrismaStoryDao } from "../agent/capabilities/story/infra/impl/prisma-story.impl.dao.js";
import { PrismaStoryMemoryDocumentDao } from "../agent/capabilities/story/infra/impl/prisma-story-memory-document.impl.dao.js";
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
import { CalcApp } from "../agent/apps/calc/calc.app.js";
import { ClockApp } from "../agent/apps/clock/clock.app.js";

type BuildAgentRuntimeInput = {
  config: Config;
  database: Database;
  llmClient: LlmClient;
  embeddingClient: EmbeddingClient;
  metricService: MetricService;
  napcatGatewayService: NapcatGatewayService;
  ithomeNewsService: IthomeNewsService;
  eventQueue: Queue<Event>;
  storyEventQueue: Queue<StoryAgentEvent>;
};

export type AgentRuntimeBundle = {
  rootAgentRuntime: RootLoopAgent;
  storyAgentRuntime: StoryLoopAgent;
  storyQueryService: StoryQueryService;
  storyReindexService: StoryReindexService;
  mainAgentContextQueryService: MainAgentContextQueryService;
  llmPlaygroundService: LlmPlaygroundService;
  restoredRootAgentSnapshot: boolean;
  hydrateColdStartAgentContext: () => Promise<void>;
  hasTavilyApiKey: boolean;
};

export async function buildAgentRuntime({
  config,
  database,
  llmClient,
  embeddingClient,
  metricService,
  napcatGatewayService,
  ithomeNewsService,
  eventQueue,
  storyEventQueue,
}: BuildAgentRuntimeInput): Promise<AgentRuntimeBundle> {
  const rootAgentRuntimeSnapshotRepository = new PrismaRootAgentRuntimeSnapshotRepository({
    database,
  });
  const storyAgentRuntimeSnapshotRepository = new PrismaStoryAgentRuntimeSnapshotRepository({
    database,
  });
  const linearMessageLedgerDao = new PrismaLinearMessageLedgerDao({ database });
  const storyDao = new PrismaStoryDao({ database });
  const storyMemoryDocumentDao = new PrismaStoryMemoryDocumentDao({ database });
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
  const agentMessageService = new DefaultAgentMessageService({
    napcatGatewayService,
  });
  const terminalStateDao = new PrismaTerminalStateDao({ database });
  const terminalOutputDao = new PrismaTerminalOutputDao({ database });

  // App 框架：先建 AppManager 并注册 Apps，再按各 App 自带的 configSchema
  // 校验 config.server.apps 的对应切片并调用 onStartup；最后由
  // createAppSubtoolOwner 在内部摊平 App 的工具，挂到主 Agent 的 InvokeTool 上。
  // 这个顺序保证 App 在贡献工具前已经完成自己的初始化（例如 TerminalApp 的
  // TerminalService 实例化 + mkdir initialCwd 都在 startupAll 里跑完）。
  const appManager = new AppManager();
  appManager.register(new CalcApp());
  appManager.register(new TerminalApp({ terminalStateDao, terminalOutputDao }));
  appManager.register(new IthomeApp({ ithomeNewsService }));
  appManager.register(new ClockApp());
  await appManager.startupAll(config.server.apps);

  // 状态树时代的子工具：明确列出，作为 createStateTreeSubtoolOwner 的输入。
  // owner-driven 模型下不再有"全局 invokeSubtools 列表"——每个 owner 自己负责
  // 列出自己拥有的工具。
  const stateTreeSubtools = [
    new SendMessageTool({
      agentMessageService,
    }),
  ];

  const agentSystemPromptFactory = async () => {
    return createAgentSystemPrompt({
      botQQ: config.server.bot.qq,
      creatorName: config.server.bot.creator.name,
      creatorQQ: config.server.bot.creator.qq,
    });
  };
  const context = new LinearMessageLedgerAgentContext({
    inner: new DefaultAgentContext({
      systemPromptFactory: agentSystemPromptFactory,
    }),
    linearMessageLedgerDao,
    runtimeKey: ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
    onLedgerAppended: count => {
      storyEventQueue.enqueue({ type: "ledger_appended", count });
    },
  });
  const rootAgentSession = new RootAgentSession({
    context,
    napcatGatewayService,
    listenGroupIds: config.server.napcat.listenGroupIds,
    recentMessageLimit: config.server.napcat.startupContextRecentMessageCount,
    notificationTimeWindowMs: config.server.agent.notificationBatchWindowMs,
    appManager,
  });
  const helpTool = new HelpTool({
    appManager,
    getCurrentApp: () => rootAgentSession.getCurrentApp(),
  });
  // 主 Agent 的 invoke 子工具所有者：App 工具的所有权和 gate 由 AppManager
  // 把握；状态树工具显式列出。InvokeTool 构造期校验 owners 之间无同名工具。
  const mainSubtoolOwners = [
    createAppSubtoolOwner({
      appManager,
      getCurrentApp: () => rootAgentSession.getCurrentApp(),
    }),
    createStateTreeSubtoolOwner({
      tools: stateTreeSubtools,
    }),
  ];

  // 主 Agent 的顶层工具实例。WebSearchTaskAgent 之后会复用这些实例的 llmTool
  // 定义（通过 OutOfScopeTool 包一层），保证两个 agent 暴露给 LLM 的 tools
  // 字段字节相等，命中 KV cache。
  const enterTool = new EnterTool({ appManager });
  const backTool = new BackTool();
  const backToPortalTool = new BackToPortalTool({ appManager });
  const waitTool = new WaitTool({
    maxWaitMs: config.server.agent.waitToolMaxWaitMs,
  });
  const mainInvokeTool = new InvokeTool({ owners: mainSubtoolOwners });
  const searchWebTool = new SearchWebTool({
    webSearchTaskAgent: webSearchTaskAgentInvoker,
  });
  const searchMemoryTool = new SearchMemoryTool({
    storyRecallService,
    topK: config.server.agent.story.memory.retrieval.topK,
  });
  const summaryTool = new SummaryTool();
  const toolCatalog = new ToolCatalog([
    enterTool,
    backTool,
    backToPortalTool,
    waitTool,
    mainInvokeTool,
    searchWebTool,
    searchMemoryTool,
    summaryTool,
    helpTool,
  ]);
  const rootAgentTools = toolCatalog.pick([
    ENTER_TOOL_NAME,
    BACK_TOOL_NAME,
    BACK_TO_PORTAL_TOOL_NAME,
    WAIT_TOOL_NAME,
    INVOKE_TOOL_NAME,
    SEARCH_WEB_TOOL_NAME,
    SEARCH_MEMORY_TOOL_NAME,
    HELP_TOOL_NAME,
  ]);

  // WebSearchTaskAgent 看到的顶层工具集：和主 Agent 一字不差（同样 8 个工具的
  // name / description / parameters / llmTool），但执行语义完全隔离——
  //  - invoke 换成 webSearchInvokeTool（owner = webSearchSubtoolOwner，只识别
  //    search_web_raw / finalize_web_search）
  //  - 其余 7 个顶层工具用 OutOfScopeTool 软包，调到就返回 OUT_OF_SCOPE 错误，
  //    不会真的改主 Agent 的 session / 触发嵌套搜索
  // 这是 prompt cache 字节相等 + 行为隔离的关键搭配。
  const webSearchAgentToolCatalog = new ToolCatalog([
    new OutOfScopeTool({
      inner: enterTool,
      reason:
        '在网页搜索子任务中不可调用 enter。请用 invoke(tool="search_web_raw", ...) 检索，必要时反复，信息足够后用 invoke(tool="finalize_web_search", summary=...) 输出最终摘要。',
    }),
    new OutOfScopeTool({
      inner: backTool,
      reason: "在网页搜索子任务中不可调用 back。",
    }),
    new OutOfScopeTool({
      inner: backToPortalTool,
      reason: "在网页搜索子任务中不可调用 back_to_portal。",
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
      inner: helpTool,
      reason: "在网页搜索子任务中不可调用 help。",
    }),
  ]);
  const webSearchAgentTools = webSearchAgentToolCatalog.pick([
    ENTER_TOOL_NAME,
    BACK_TOOL_NAME,
    BACK_TO_PORTAL_TOOL_NAME,
    WAIT_TOOL_NAME,
    INVOKE_TOOL_NAME,
    SEARCH_WEB_TOOL_NAME,
    SEARCH_MEMORY_TOOL_NAME,
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
  const storyRecallScheduler = new StoryRecallScheduler({
    llmClient,
    storyRecallService,
    agentContext: context,
    eventQueue,
    availableTools: rootAgentTools.definitions(),
    topK: config.server.agent.story.recall.topK,
    scoreThreshold: config.server.agent.story.recall.scoreThreshold,
  });
  const storyRecallExtension = new StoryRecallExtension({
    scheduler: storyRecallScheduler,
  });
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
    loopExtensions: [storyRecallExtension],
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
        SEARCH_WEB_TOOL_NAME,
        SEARCH_MEMORY_TOOL_NAME,
        BACK_TOOL_NAME,
        BACK_TO_PORTAL_TOOL_NAME,
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
    storyQueryService,
    storyReindexService,
    mainAgentContextQueryService,
    llmPlaygroundService,
    restoredRootAgentSnapshot,
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
  };
}
