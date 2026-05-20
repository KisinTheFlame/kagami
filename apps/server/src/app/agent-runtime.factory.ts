import {
  AppManager,
  HELP_TOOL_NAME,
  HelpTool,
  ToolCatalog,
  type Queue,
} from "@kagami/agent-runtime";
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
import type { AgentDashboardQueryService } from "../ops/application/agent-dashboard-query.service.js";
import { DefaultStoryQueryService } from "../ops/application/story-query.impl.service.js";
import { DefaultStoryReindexService } from "../ops/application/story-reindex.impl.service.js";
import { DefaultAgentDashboardQueryService } from "../ops/application/agent-dashboard-query.impl.service.js";
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
import { OpenIthomeArticleTool } from "../agent/capabilities/news/tools/open-ithome-article.tool.js";
import {
  TerminalService,
  resolveTerminalInitialCwd,
} from "../agent/capabilities/terminal/application/terminal.service.js";
import { PrismaTerminalStateDao } from "../agent/capabilities/terminal/infra/prisma-terminal-state.dao.js";
import { PrismaTerminalOutputDao } from "../agent/capabilities/terminal/infra/prisma-terminal-output.dao.js";
import { BashTool } from "../agent/capabilities/terminal/tools/bash.tool.js";
import { ReadBashOutputTool } from "../agent/capabilities/terminal/tools/read-bash-output.tool.js";
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
  agentDashboardQueryService: AgentDashboardQueryService;
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
  const agentMessageService = new DefaultAgentMessageService({
    napcatGatewayService,
  });
  const terminalStateDao = new PrismaTerminalStateDao({ database });
  const terminalOutputDao = new PrismaTerminalOutputDao({ database });
  const terminalConfig = config.server.agent.terminal;
  const terminalService = new TerminalService({
    config: {
      initialCwd: resolveTerminalInitialCwd({ initialCwd: terminalConfig.initialCwd }),
      commandTimeoutMs: terminalConfig.commandTimeoutMs,
      previewBytes: terminalConfig.previewBytes,
      maxOutputBytes: terminalConfig.maxOutputBytes,
      maxCommandLength: terminalConfig.maxCommandLength,
      readOutputMaxSize: terminalConfig.readOutputMaxSize,
      shell: terminalConfig.shell,
    },
    terminalStateDao,
    terminalOutputDao,
  });
  await terminalService.initialize();

  // App 框架：先建 AppManager 并注册 Apps，再把它们的 tools 拼进 invokeSubtools。
  // 这个顺序保证 App 的工具能被 InvokeTool 调度到。
  const appManager = new AppManager();
  appManager.register(new CalcApp());

  const invokeSubtools = [
    new SendMessageTool({
      agentMessageService,
    }),
    new OpenIthomeArticleTool(),
    new BashTool({ terminalService }),
    new ReadBashOutputTool({ terminalService }),
    // App 提供的工具：每个已注册 App 的 tools 在这里被 flat 进总集合
    ...appManager.getAllApps().flatMap(app => [...app.tools]),
  ];

  const agentSystemPromptFactory = async () => {
    return createAgentSystemPrompt({
      botQQ: config.server.bot.qq,
      creatorName: config.server.bot.creator.name,
      creatorQQ: config.server.bot.creator.qq,
      invokeToolDefinitions: invokeSubtools.map(tool => tool.llmTool),
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
    ithomeNewsService,
    terminalService,
    appManager,
  });
  const helpTool = new HelpTool({
    appManager,
    getCurrentApp: () => rootAgentSession.getCurrentApp(),
  });
  const toolCatalog = new ToolCatalog([
    new EnterTool({ appManager }),
    new BackTool(),
    new BackToPortalTool(),
    new WaitTool({
      eventQueue,
      maxWaitMs: config.server.agent.waitToolMaxWaitMs,
    }),
    new InvokeTool({
      tools: invokeSubtools,
      appManager,
    }),
    new SearchWebTool({
      webSearchTaskAgent,
    }),
    new SearchMemoryTool({
      storyRecallService,
      topK: config.server.agent.story.memory.retrieval.topK,
    }),
    new SummaryTool(),
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
  const agentDashboardQueryService = new DefaultAgentDashboardQueryService({
    rootAgentRuntime,
    storyAgentRuntime,
    eventQueue,
    listAvailableAgentProviders: async () => {
      return await llmClient.listAvailableProviders({ usage: "agent" });
    },
  });

  return {
    rootAgentRuntime,
    storyAgentRuntime,
    storyQueryService,
    storyReindexService,
    agentDashboardQueryService,
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
