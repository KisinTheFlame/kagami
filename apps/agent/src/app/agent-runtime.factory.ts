import {
  AppManager,
  AsyncTaskManager,
  createAppSubtoolOwner,
  createUnguardedSubtoolOwner,
  HELP_TOOL_NAME,
  HelpTool,
  OutOfScopeTool,
  ToolCatalog,
  type Queue,
  type ToolComponent,
} from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { Config } from "@kagami/kernel/config/config.loader";
import type { Database } from "@kagami/persistence/db/client";
import type { LlmClient } from "@kagami/llm-client";
import { DefaultLlmPlaygroundService } from "../llm/application/llm-playground.impl.service.js";
import type { LlmPlaygroundService } from "../llm/application/llm-playground.service.js";
import type { MetricService } from "../metric/application/metric.service.js";
import type { ConfigManager } from "@kagami/kernel/config/config.manager";
import type { NapcatQqMessageDao } from "@kagami/persistence/dao/napcat-group-message.dao";
import type { NapcatGatewayPersistenceWriter } from "../napcat/application/napcat-gateway/event-persistence-writer.js";
import type { NapcatImageMessageAnalyzer } from "../napcat/application/napcat-gateway/image-message-analyzer.js";
import type { AgentMessageService } from "../agent/capabilities/messaging/application/agent-message.service.js";
import type { IthomeService } from "../agent/capabilities/ithome/application/ithome.service.js";
import type { MainAgentContextQueryService } from "../ops/application/main-agent-context-query.service.js";
import { DefaultMainAgentContextQueryService } from "../ops/application/main-agent-context-query.impl.service.js";
import { DefaultAgentContext } from "../agent/runtime/context/default-agent-context.js";
import { LinearMessageLedgerAgentContext } from "../agent/runtime/context/linear-message-ledger-agent-context.js";
import type { Event } from "../agent/runtime/event/event.js";
import { RootLoopAgent } from "../agent/runtime/root-agent/root-agent-runtime.js";
import { PrismaRootAgentRuntimeSnapshotRepository } from "../agent/runtime/root-agent/persistence/prisma-root-agent-runtime-snapshot.repository.js";
import { ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY } from "../agent/runtime/root-agent/persistence/root-agent-runtime-snapshot.repository.js";
import { createAgentSystemPrompt } from "../agent/runtime/root-agent/system-prompt.js";
import { RootAgentSession } from "../agent/runtime/root-agent/session/root-agent-session.js";
import { FOREGROUND_METRIC_KNOCK } from "../agent/runtime/root-agent/foreground-input.js";
import { SwitchTool, SWITCH_TOOL_NAME } from "../agent/runtime/root-agent/tools/switch.tool.js";
import {
  ListAppsTool,
  LIST_APPS_TOOL_NAME,
} from "../agent/runtime/root-agent/tools/list-apps.tool.js";
import { InvokeTool, INVOKE_TOOL_NAME } from "../agent/runtime/root-agent/tools/invoke.tool.js";
import { WaitTool, WAIT_TOOL_NAME } from "../agent/runtime/root-agent/tools/wait.tool.js";
import { createRootContextSummaryReminderMessage } from "../agent/runtime/context/context-message-factory.js";
import { TavilyWebSearchService } from "../agent/capabilities/web-search/application/tavily-web-search.service.js";
import { SearchWebRawTool } from "../agent/capabilities/web-search/task-agent/tools/search-web-raw.tool.js";
import { FinalizeWebSearchTool } from "../agent/capabilities/web-search/task-agent/tools/finalize-web-search.tool.js";
import { WebSearchTaskAgent } from "../agent/capabilities/web-search/task-agent/web-search-task-agent.js";
import {
  createSearchWebTool,
  SEARCH_WEB_TOOL_NAME,
} from "../agent/capabilities/web-search/tools/search-web.tool.js";
import { SummaryTaskAgent } from "../agent/capabilities/context-summary/task-agent/summary-task-agent.js";
import { FinalizeSummaryTool } from "../agent/capabilities/context-summary/task-agent/tools/finalize-summary.tool.js";
import { TodoSuggestionTaskAgent } from "../agent/capabilities/todo/task-agent/todo-suggestion-task-agent.js";
import { ProposeTodosTool } from "../agent/capabilities/todo/task-agent/tools/propose-todos.tool.js";
import { PrismaTerminalStateDao } from "../agent/capabilities/terminal/infra/prisma-terminal-state.dao.js";
import { PrismaTerminalOutputDao } from "../agent/capabilities/terminal/infra/prisma-terminal-output.dao.js";
import { TerminalApp } from "../agent/apps/terminal/terminal.app.js";
import { IthomeApp } from "../agent/apps/ithome/ithome.app.js";
import { BrowserApp } from "../agent/apps/browser/browser.app.js";
import type { BrowserClient } from "../browser/browser-client.js";
import { SpireApp } from "../agent/apps/spire/spire.app.js";
import type { SpireClient } from "../spire/spire-client.js";
import { TodoApp } from "../agent/apps/todo/todo.app.js";
import type { TodoService } from "../agent/capabilities/todo/application/todo.service.js";
import { PrismaLinearMessageLedgerDao } from "../agent/capabilities/ledger/infra/impl/prisma-linear-message-ledger.impl.dao.js";
import { AppEntryResetExtension } from "../agent/runtime/root-agent/extensions/app-entry-reset.extension.js";
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
  metricService: MetricService;
  napcat: NapcatGatewayDeps;
  ithomeService: IthomeService;
  todoService: TodoService;
  notificationCenter: NotificationCenter;
  eventQueue: Queue<Event>;
  /** 自建对象存储客户端；缺省（server.oss 未配）时资源读取/发送/截图落 OSS 优雅降级。 */
  ossClient?: OssClient;
  /** 浏览器动作客户端：打到独立的 kagami-browser 进程（issue #173）。 */
  browserClient: BrowserClient;
  /** 尖塔游戏动作客户端：打到独立的 kagami-spire 进程（issue #234）。 */
  spireClient: SpireClient;
};

export type AgentRuntimeBundle = {
  rootAgentRuntime: RootLoopAgent;
  mainAgentContextQueryService: MainAgentContextQueryService;
  llmPlaygroundService: LlmPlaygroundService;
  hasTavilyApiKey: boolean;
  /**
   * 「发现待办」task agent：工具装配与主 Agent 字节相等（tools / system 前缀命中
   * KV 缓存），invoke 只挂 propose_todos 终止子工具。由 wiring 层包进
   * TodoSuggestionService（重试/降级外壳）供 digest 使用。
   */
  todoSuggestionTaskAgent: TodoSuggestionTaskAgent;
  /** QQ App：手机 OS 模型下聊天的承载者，已收纳 napcat 网关（自管生命周期 + 入站事件）。 */
  qqApp: QqApp;
  /** QQ 出站发送端口（收口）：管理台直发 HTTP 走这里，不碰裸网关。 */
  qqOutboundService: AgentMessageService;
  /** 反序关停所有 App 的 onShutdown（含 QQ App 停网关）。由服务关停链调用。 */
  shutdownApps: () => Promise<void>;
};

const logger = new AppLogger({ source: "agent.runtime-factory" });

export async function buildAgentRuntime({
  config,
  database,
  llmClient,
  metricService,
  napcat,
  ithomeService,
  todoService,
  notificationCenter,
  eventQueue,
  ossClient,
  browserClient,
  spireClient,
}: BuildAgentRuntimeInput): Promise<AgentRuntimeBundle> {
  const rootAgentRuntimeSnapshotRepository = new PrismaRootAgentRuntimeSnapshotRepository({
    database,
  });
  const linearMessageLedgerDao = new PrismaLinearMessageLedgerDao({ database });

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
    owners: [createUnguardedSubtoolOwner({ tools: webSearchSubtools })],
  });

  // WebSearchTaskAgent 的 taskTools 需要等到主 Agent rootAgentTools 装配完才能
  // 拼出来（要拿 switch / list_apps / wait / search_web / help 等
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
    // 前台输入敲门端口：knock 计数（fire-and-forget）+ enqueue 不带内容的敲门事件。
    // 与 inject / drain_empty（session 侧）合成前台路径的三计数观测。
    notifyForegroundInput: () => {
      void metricService
        .record({ metricName: FOREGROUND_METRIC_KNOCK, value: 1, tags: { runtime: "agent" } })
        .catch(() => undefined);
      eventQueue.enqueue({ type: "foreground_input" });
    },
    botQQ: config.server.bot.qq,
    creatorName: config.server.bot.creator.name,
    creatorQQ: config.server.bot.creator.qq,
    listenGroupIds: config.server.napcat.listenGroupIds,
    recentMessageLimit: config.server.napcat.startupContextRecentMessageCount,
    aiTone: {
      enabled: config.server.agent.messaging.aiTone.enabled,
      blockThreshold: config.server.agent.messaging.aiTone.blockThreshold,
    },
    resourceService,
    ossClient,
    fileMaxBytes: config.server.agent.resource.fileMaxBytes,
  });

  // App 框架：先建 AppManager 并注册 Apps，再按各 App 的 configSchema 校验
  // config.server.apps 切片并 onStartup；createAppSubtoolOwner 在内部摊平 App 工具
  // 挂到主 Agent 的 InvokeTool 上。注入 App 状态持久化能力：startup 时恢复、shutdown
  // 时存档各 App 自己的状态（如 QQ 未读红点），走 app_state 通用表。
  const appManager = new AppManager({
    stateStore: new PrismaAppStateStore({ database }),
    onStateError: ({ appId, phase, error }) => {
      // 状态恢复/存档失败虽不阻断启停，但绝不静默：跨重启状态（如 QQ 未读红点）无声丢失
      // 会让运维完全无从察觉，故落结构化日志。
      logger.errorWithCause(
        `App "${appId}" 状态${phase === "restore" ? "恢复" : "存档"}失败`,
        error,
        {
          event: "agent.app_state.persist_failed",
          appId,
          phase,
        },
      );
    },
  });
  appManager.register(new CalcApp());
  appManager.register(new TerminalApp({ terminalStateDao, terminalOutputDao }));
  appManager.register(new IthomeApp({ ithomeService }));
  appManager.register(new TodoApp({ todoService }));
  appManager.register(new ClockApp());
  appManager.register(new HnApp());
  appManager.register(new AmapApp({ ossClient }));
  appManager.register(new BrowserApp({ browserClient, ossClient }));
  appManager.register(new SpireApp({ spireClient }));
  appManager.register(qqApp);
  await appManager.startupAll(config.server.apps);

  const agentSystemPromptFactory = async () => {
    return createAgentSystemPrompt({
      creatorName: config.server.bot.creator.name,
    });
  };
  // root agent 每条进上下文的消息追加到 ledger（physical table `ledger`），只写不读，
  // 作为将来记忆系统的原始素材来源。
  const context = new LinearMessageLedgerAgentContext({
    inner: new DefaultAgentContext({
      systemPromptFactory: agentSystemPromptFactory,
    }),
    linearMessageLedgerDao,
    runtimeKey: ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  });
  const rootAgentSession = new RootAgentSession({
    context,
    appManager,
    metricService,
  });
  const helpTool = new HelpTool({
    appManager,
    getCurrentApp: () => rootAgentSession.getCurrentApp(),
    // 导航语义（怎么进入 App）是 Kagami 的，不属于通用内核：文案在这里注入。
    notInAppHint:
      "你不在任何 App 里。先用 switch 进入一个 App，再调用 help 查看那个 App 能做什么；想知道有哪些 App 用 list_apps。",
    appNotFoundHint: (appId: string) =>
      `当前所在 App "${appId}" 已找不到。可能被卸载或重启过，用 list_apps 看看现在有哪些 App。`,
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
  const switchTool = new SwitchTool({ appManager });
  const listAppsTool = new ListAppsTool({ appManager });
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
  const readResourceTool = new ReadResourceTool({ resourceService });
  const downloadResourceTool = new DownloadResourceTool({ resourceFileService });
  const uploadResourceTool = new UploadResourceTool({ resourceFileService });
  const toolCatalog = new ToolCatalog([
    switchTool,
    listAppsTool,
    waitTool,
    mainInvokeTool,
    searchWebTool,
    readResourceTool,
    downloadResourceTool,
    uploadResourceTool,
    helpTool,
  ]);
  const rootAgentTools = toolCatalog.pick([
    SWITCH_TOOL_NAME,
    LIST_APPS_TOOL_NAME,
    WAIT_TOOL_NAME,
    INVOKE_TOOL_NAME,
    SEARCH_WEB_TOOL_NAME,
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
      inner: switchTool,
      reason:
        '在网页搜索子任务中不可调用 switch。请用 invoke(tool="search_web_raw", ...) 检索，必要时反复，信息足够后用 invoke(tool="finalize_web_search", summary=...) 输出最终摘要。',
    }),
    new OutOfScopeTool({
      inner: listAppsTool,
      reason: "在网页搜索子任务中不可调用 list_apps。",
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
    SWITCH_TOOL_NAME,
    LIST_APPS_TOOL_NAME,
    WAIT_TOOL_NAME,
    INVOKE_TOOL_NAME,
    SEARCH_WEB_TOOL_NAME,
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
  // SummaryTaskAgent 的工具装配与 WebSearchTaskAgent 同构：顶层工具集和主 Agent
  // 一字不差（9 个工具的 name / description / parameters / llmTool），执行语义
  // 完全隔离——invoke 换成只识别 finalize_summary 的实例，其余 8 个顶层工具用
  // OutOfScopeTool 软包。prompt cache 字节相等 + 行为隔离的同一套搭配。
  const summaryInvokeTool = new InvokeTool({
    owners: [createUnguardedSubtoolOwner({ tools: [new FinalizeSummaryTool()] })],
  });
  const summaryAgentToolCatalog = new ToolCatalog([
    new OutOfScopeTool({
      inner: switchTool,
      reason:
        '在上下文摘要子任务中不可调用 switch。请用 invoke(tool="finalize_summary", summary=...) 提交最终摘要。',
    }),
    new OutOfScopeTool({
      inner: listAppsTool,
      reason: "在上下文摘要子任务中不可调用 list_apps。",
    }),
    new OutOfScopeTool({
      inner: waitTool,
      reason: "在上下文摘要子任务中不可调用 wait。",
    }),
    summaryInvokeTool,
    new OutOfScopeTool({
      inner: searchWebTool,
      reason: "在上下文摘要子任务中不可调用 search_web。",
    }),
    new OutOfScopeTool({
      inner: readResourceTool,
      reason: "在上下文摘要子任务中不可调用 read_resource。",
    }),
    new OutOfScopeTool({
      inner: downloadResourceTool,
      reason: "在上下文摘要子任务中不可调用 download_resource。",
    }),
    new OutOfScopeTool({
      inner: uploadResourceTool,
      reason: "在上下文摘要子任务中不可调用 upload_resource。",
    }),
    new OutOfScopeTool({
      inner: helpTool,
      reason: "在上下文摘要子任务中不可调用 help。",
    }),
  ]);
  const summaryAgentTools = summaryAgentToolCatalog.pick([
    SWITCH_TOOL_NAME,
    LIST_APPS_TOOL_NAME,
    WAIT_TOOL_NAME,
    INVOKE_TOOL_NAME,
    SEARCH_WEB_TOOL_NAME,
    READ_RESOURCE_TOOL_NAME,
    DOWNLOAD_RESOURCE_TOOL_NAME,
    UPLOAD_RESOURCE_TOOL_NAME,
    HELP_TOOL_NAME,
  ]);
  const summaryTaskAgent = new SummaryTaskAgent({
    llmClient,
    taskTools: summaryAgentTools,
    reminderMessageFactory: createRootContextSummaryReminderMessage,
  });
  // TodoSuggestionTaskAgent：同一套镜像装配，invoke 只挂 propose_todos 终止子工具。
  const todoInvokeTool = new InvokeTool({
    owners: [createUnguardedSubtoolOwner({ tools: [new ProposeTodosTool()] })],
  });
  const todoAgentToolCatalog = new ToolCatalog([
    new OutOfScopeTool({
      inner: switchTool,
      reason:
        '在「发现待办」子任务中不可调用 switch。请用 invoke(tool="propose_todos", suggestions=[...]) 提交候选待办。',
    }),
    new OutOfScopeTool({
      inner: listAppsTool,
      reason: "在「发现待办」子任务中不可调用 list_apps。",
    }),
    new OutOfScopeTool({
      inner: waitTool,
      reason: "在「发现待办」子任务中不可调用 wait。",
    }),
    todoInvokeTool,
    new OutOfScopeTool({
      inner: searchWebTool,
      reason: "在「发现待办」子任务中不可调用 search_web。",
    }),
    new OutOfScopeTool({
      inner: readResourceTool,
      reason: "在「发现待办」子任务中不可调用 read_resource。",
    }),
    new OutOfScopeTool({
      inner: downloadResourceTool,
      reason: "在「发现待办」子任务中不可调用 download_resource。",
    }),
    new OutOfScopeTool({
      inner: uploadResourceTool,
      reason: "在「发现待办」子任务中不可调用 upload_resource。",
    }),
    new OutOfScopeTool({
      inner: helpTool,
      reason: "在「发现待办」子任务中不可调用 help。",
    }),
  ]);
  const todoAgentTools = todoAgentToolCatalog.pick([
    SWITCH_TOOL_NAME,
    LIST_APPS_TOOL_NAME,
    WAIT_TOOL_NAME,
    INVOKE_TOOL_NAME,
    SEARCH_WEB_TOOL_NAME,
    READ_RESOURCE_TOOL_NAME,
    DOWNLOAD_RESOURCE_TOOL_NAME,
    UPLOAD_RESOURCE_TOOL_NAME,
    HELP_TOOL_NAME,
  ]);
  const todoSuggestionTaskAgent = new TodoSuggestionTaskAgent({
    llmClient,
    taskTools: todoAgentTools,
  });
  const rootAgentRuntime = new RootLoopAgent({
    llmClient,
    context,
    eventQueue,
    session: rootAgentSession,
    snapshotRepository: rootAgentRuntimeSnapshotRepository,
    tools: rootAgentTools,
    contextSummarizer: summaryTaskAgent,
    contextCompactionTotalTokenThreshold: config.server.agent.contextCompactionTotalTokenThreshold,
    metricService,
    llmRetryBackoffMs: config.server.agent.llmRetryBackoffMs,
    loopExtensions: [new AppEntryResetExtension({ session: rootAgentSession })],
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
        SWITCH_TOOL_NAME,
        LIST_APPS_TOOL_NAME,
        WAIT_TOOL_NAME,
        INVOKE_TOOL_NAME,
        SEARCH_WEB_TOOL_NAME,
        READ_RESOURCE_TOOL_NAME,
        HELP_TOOL_NAME,
      ])
      .definitions(),
  });
  const mainAgentContextQueryService = new DefaultMainAgentContextQueryService({
    rootAgentRuntime,
  });

  return {
    rootAgentRuntime,
    mainAgentContextQueryService,
    llmPlaygroundService,
    hasTavilyApiKey: Boolean(config.server.tavily.apiKey),
    todoSuggestionTaskAgent,
    qqApp,
    qqOutboundService,
    shutdownApps: () => appManager.shutdownAll(),
  };
}
