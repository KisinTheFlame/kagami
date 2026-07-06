import {
  AppManager,
  createAppSubtoolOwner,
  createUnguardedSubtoolOwner,
  HelpTool,
  OutOfScopeTool,
  ToolCatalog,
  type Queue,
  type ToolComponent,
  type ToolExecutor,
} from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { Config } from "@kagami/kernel/config/config.loader";
import type { Database } from "@kagami/persistence/db/client";
import { PrismaInnerThoughtDao } from "@kagami/persistence/dao/impl/inner-thought.impl.dao";
import type { LlmClient } from "@kagami/llm-client";
import { DefaultLlmProviderService } from "../llm/application/llm-provider.impl.service.js";
import type { LlmProviderService } from "../llm/application/llm-provider.service.js";
import type { MetricClient } from "@kagami/metric-client/client";
import type { NapcatClient } from "../acl/napcat-client.js";
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
import { InvokeTool, INVOKE_TOOL_NAME } from "../agent/runtime/root-agent/tools/invoke.tool.js";
import { WaitTool } from "../agent/runtime/root-agent/tools/wait.tool.js";
import { createRootContextSummaryReminderMessage } from "../agent/runtime/context/context-message-factory.js";
import { SummaryTaskAgent } from "../agent/capabilities/context-summary/task-agent/summary-task-agent.js";
import { FinalizeSummaryTool } from "../agent/capabilities/context-summary/task-agent/tools/finalize-summary.tool.js";
import { TodoSuggestionTaskAgent } from "../agent/capabilities/todo/task-agent/todo-suggestion-task-agent.js";
import { ProposeTodosTool } from "../agent/capabilities/todo/task-agent/tools/propose-todos.tool.js";
import { EmitInnerThoughtTool } from "../agent/capabilities/inner-voice/tools/emit-inner-thought.tool.js";
import { InnerVoiceTaskAgent } from "../agent/capabilities/inner-voice/task-agent/inner-voice-task-agent.js";
import { InnerVoiceIdleTracker } from "../agent/capabilities/inner-voice/domain/idle-tracker.js";
import { collectInnerVoiceIdleSignals } from "../agent/capabilities/inner-voice/domain/ledger-idle-signals.js";
import { InnerVoiceExtension } from "../agent/runtime/root-agent/extensions/inner-voice.extension.js";
import { PrismaTerminalStateDao } from "../agent/capabilities/terminal/infra/prisma-terminal-state.dao.js";
import { PrismaTerminalOutputDao } from "../agent/capabilities/terminal/infra/prisma-terminal-output.dao.js";
import { TerminalApp } from "../agent/apps/terminal/terminal.app.js";
import { IthomeApp } from "../agent/apps/ithome/ithome.app.js";
import { BrowserApp } from "../agent/apps/browser/browser.app.js";
import type { BrowserClient } from "../acl/browser-client.js";
import { SpireApp } from "../agent/apps/spire/spire.app.js";
import type { SpireClient } from "../acl/spire-client.js";
import { PixelApp } from "../agent/apps/pixel/pixel.app.js";
import type { PixelClient } from "../acl/pixel-client.js";
import { TodoApp } from "../agent/apps/todo/todo.app.js";
import type { TodoService } from "../agent/capabilities/todo/application/todo.service.js";
import { PrismaLinearMessageLedgerDao } from "../agent/capabilities/ledger/infra/impl/prisma-linear-message-ledger.impl.dao.js";
import { AppEntryResetExtension } from "../agent/runtime/root-agent/extensions/app-entry-reset.extension.js";
import { ResourceService } from "../agent/capabilities/resource/application/resource.service.js";
import { ResourceFileService } from "../agent/capabilities/resource/application/resource-file.service.js";
import { ReadResourceTool } from "../agent/capabilities/resource/tools/read-resource.tool.js";
import { DownloadResourceTool } from "../agent/capabilities/resource/tools/download-resource.tool.js";
import { UploadResourceTool } from "../agent/capabilities/resource/tools/upload-resource.tool.js";
import type { OssClient } from "../acl/oss-client.js";
import { CalcApp } from "../agent/apps/calc/calc.app.js";
import { ClockApp } from "../agent/apps/clock/clock.app.js";
import { HnApp } from "../agent/apps/hn/hn.app.js";
import { AmapApp } from "../agent/apps/amap/amap.app.js";
import type { QqApp } from "../agent/apps/qq/qq.app.js";
import { buildQqApp } from "../agent/apps/qq/qq-app.factory.js";
import { PrismaAppStateStore } from "../agent/runtime/app-state/prisma-app-state-store.js";
import type { NotificationCenter } from "../agent/runtime/root-agent/notification/notification-center.js";

type BuildAgentRuntimeInput = {
  config: Config;
  database: Database;
  llmClient: LlmClient;
  metricService: MetricClient;
  /** QQ 出站门面：打到独立的 kagami-napcat 进程（issue #347）。入站由 server-runtime 的订阅者注入。 */
  napcatClient: NapcatClient;
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
  /** 像素画动作客户端：打到独立的 kagami-pixel 进程（issue #365）。 */
  pixelClient: PixelClient;
};

export type AgentRuntimeBundle = {
  rootAgentRuntime: RootLoopAgent;
  mainAgentContextQueryService: MainAgentContextQueryService;
  /** LLM provider 列举服务：管理台「LLM 调用历史」按 provider 过滤用（/llm/providers 路由）。 */
  llmProviderService: LlmProviderService;
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

/**
 * fork 型 task agent（summary / todo）的镜像工具目录：与主 Agent
 * 顶层工具集一字不差（同样的 name / description / parameters / llmTool 与顺序），
 * 执行语义完全隔离——invoke 换成只挂该 task agent 子工具的实例，其余顶层工具用
 * OutOfScopeTool 软包，调到就返回 OUT_OF_SCOPE 错误，不会真的改主 Agent 的
 * session。这是 prompt cache 字节相等 + 行为隔离的关键搭配。
 *
 * 从主 Agent 的同一份有序清单（mainTopLevelTools）派生：主 Agent 加/删/重排
 * 顶层工具时所有镜像自动跟随，不会漂移出字节不等的 tools 前缀。
 */
function createMirroredTaskAgentTools({
  mainTopLevelTools,
  invokeTool,
  overrideReasons = {},
  defaultReason,
}: {
  mainTopLevelTools: readonly ToolComponent[];
  invokeTool: ToolComponent;
  /** 个别工具的定制拒绝话术（如 switch 上顺带指路终止子工具）。 */
  overrideReasons?: Record<string, string>;
  defaultReason: (toolName: string) => string;
}): ToolExecutor {
  const mirrored = mainTopLevelTools.map(tool =>
    tool.name === INVOKE_TOOL_NAME
      ? invokeTool
      : new OutOfScopeTool({
          inner: tool,
          reason: overrideReasons[tool.name] ?? defaultReason(tool.name),
        }),
  );
  return new ToolCatalog(mirrored).pick(mirrored.map(tool => tool.name));
}

export async function buildAgentRuntime({
  config,
  database,
  llmClient,
  metricService,
  napcatClient,
  ithomeService,
  todoService,
  notificationCenter,
  eventQueue,
  ossClient,
  browserClient,
  spireClient,
  pixelClient,
}: BuildAgentRuntimeInput): Promise<AgentRuntimeBundle> {
  const rootAgentRuntimeSnapshotRepository = new PrismaRootAgentRuntimeSnapshotRepository({
    database,
  });
  const linearMessageLedgerDao = new PrismaLinearMessageLedgerDao({ database });

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
  const { qqApp, outboundService: qqOutboundService } = buildQqApp({
    napcatClient,
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
      const phaseLabel =
        phase === "restore" ? "恢复" : phase === "shutdown" ? "启动回滚关停" : "存档";
      logger.errorWithCause(`App "${appId}" 状态${phaseLabel}失败`, error, {
        event: "agent.app_state.persist_failed",
        appId,
        phase,
      });
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
  appManager.register(new PixelApp({ pixelClient, ossClient }));
  appManager.register(qqApp);
  await appManager.startupAll(config.server.apps);

  const agentSystemPromptFactory = async () => {
    return createAgentSystemPrompt({
      creatorName: config.server.bot.creator.name,
      apps: appManager.getAllApps().map(app => ({ id: app.id, displayName: app.displayName })),
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
      "你不在任何 App 里。先用 switch 进入一个 App，再调用 help 查看那个 App 能做什么；有哪些 App 见系统说明里的 App 列表。",
    appNotFoundHint: (appId: string) =>
      `当前所在 App "${appId}" 已找不到。可能被卸载或重启过，现在有哪些 App 见系统说明里的 App 列表。`,
  });
  // 主 Agent 的 invoke 子工具所有者：全部 App 工具（含 QQ 的 send_message）由
  // AppManager 把握所有权与 gate。状态树时代的 owner 已退役。
  const mainSubtoolOwners = [
    createAppSubtoolOwner({
      appManager,
      getCurrentApp: () => rootAgentSession.getCurrentApp(),
    }),
  ];

  // 主 Agent 的顶层工具实例。fork 型 task agent（summary / todo）之后会复用这些
  // 实例的 llmTool 定义（通过 OutOfScopeTool 包一层），保证各 agent 暴露给 LLM 的
  // tools 字段字节相等，命中 KV cache。
  const switchTool = new SwitchTool({ appManager });
  const waitTool = new WaitTool({
    maxWaitMs: config.server.agent.waitToolMaxWaitMs,
  });
  const mainInvokeTool = new InvokeTool({ owners: mainSubtoolOwners });
  const readResourceTool = new ReadResourceTool({ resourceService });
  const downloadResourceTool = new DownloadResourceTool({ resourceFileService });
  const uploadResourceTool = new UploadResourceTool({ resourceFileService });
  // 主 Agent 顶层工具的唯一有序清单：toolCatalog / rootAgentTools / 三个 fork 型
  // task agent 的镜像目录都从它派生。顺序即 LLM tools 数组顺序，是 KV 缓存稳定
  // 前缀的一部分——加/删/重排只改这一处。
  const mainTopLevelTools: ToolComponent[] = [
    switchTool,
    waitTool,
    mainInvokeTool,
    readResourceTool,
    downloadResourceTool,
    uploadResourceTool,
    helpTool,
  ];
  const toolCatalog = new ToolCatalog(mainTopLevelTools);
  const rootAgentTools = toolCatalog.pick(mainTopLevelTools.map(tool => tool.name));

  // 两个 fork 型 task agent（summary / todo）共用同一套镜像装配，从主 Agent 的
  // 同一份有序顶层工具清单派生（见 createMirroredTaskAgentTools），主 Agent 加/删/
  // 重排工具时镜像自动跟随，不会漂移出字节不等的 tools 前缀。
  // SummaryTaskAgent：同一套镜像装配，invoke 只挂 finalize_summary 终止子工具。
  const summaryInvokeTool = new InvokeTool({
    owners: [createUnguardedSubtoolOwner({ tools: [new FinalizeSummaryTool()] })],
  });
  const summaryAgentTools = createMirroredTaskAgentTools({
    mainTopLevelTools,
    invokeTool: summaryInvokeTool,
    overrideReasons: {
      [SWITCH_TOOL_NAME]:
        '在上下文摘要子任务中不可调用 switch。请用 invoke(tool="finalize_summary", summary=...) 提交最终摘要。',
    },
    defaultReason: toolName => `在上下文摘要子任务中不可调用 ${toolName}。`,
  });
  const summaryTaskAgent = new SummaryTaskAgent({
    llmClient,
    taskTools: summaryAgentTools,
    reminderMessageFactory: createRootContextSummaryReminderMessage,
  });
  // TodoSuggestionTaskAgent：同一套镜像装配，invoke 只挂 propose_todos 终止子工具。
  const todoInvokeTool = new InvokeTool({
    owners: [createUnguardedSubtoolOwner({ tools: [new ProposeTodosTool()] })],
  });
  const todoAgentTools = createMirroredTaskAgentTools({
    mainTopLevelTools,
    invokeTool: todoInvokeTool,
    overrideReasons: {
      [SWITCH_TOOL_NAME]:
        '在「发现待办」子任务中不可调用 switch。请用 invoke(tool="propose_todos", suggestions=[...]) 提交候选待办。',
    },
    defaultReason: toolName => `在「发现待办」子任务中不可调用 ${toolName}。`,
  });
  const todoSuggestionTaskAgent = new TodoSuggestionTaskAgent({
    llmClient,
    taskTools: todoAgentTools,
  });
  // 内心独白（issue #265 / #410）：摸鱼判定 tracker + 镜像装配 TaskAgent + loop
  // extension。与 summary / todo 同一套镜像装配，invoke 只挂
  // emit_inner_thought 终止子工具，其余顶层工具 OutOfScope 软拒绝——请求前缀与主
  // Agent 字节相等，命中 Anthropic prompt cache。
  const innerVoiceIdleTracker = new InnerVoiceIdleTracker();
  const innerVoiceInvokeTool = new InvokeTool({
    owners: [createUnguardedSubtoolOwner({ tools: [new EmitInnerThoughtTool()] })],
  });
  const innerVoiceAgentTools = createMirroredTaskAgentTools({
    mainTopLevelTools,
    invokeTool: innerVoiceInvokeTool,
    overrideReasons: {
      [SWITCH_TOOL_NAME]:
        '在内心独白子任务中不可调用 switch。请用 invoke(tool="emit_inner_thought", thought=...) 提交念头。',
    },
    defaultReason: toolName => `在内心独白子任务中不可调用 ${toolName}。`,
  });
  const innerVoiceTaskAgent = new InnerVoiceTaskAgent({
    llmClient,
    taskTools: innerVoiceAgentTools,
  });
  const innerVoiceExtension = new InnerVoiceExtension({
    tracker: innerVoiceIdleTracker,
    taskAgent: innerVoiceTaskAgent,
    eventQueue,
    metricService,
    innerThoughtDao: new PrismaInnerThoughtDao({ database }),
    runtimeKey: ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
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
    // 纯文本轮挂起的自唤醒兜底与 wait 工具共用同一个上限，语义一致：Agent 最多
    // 安静这么久就会自己醒来一轮。
    idleWakeMaxWaitMs: config.server.agent.waitToolMaxWaitMs,
    loopExtensions: [
      new AppEntryResetExtension({ session: rootAgentSession }),
      innerVoiceExtension,
    ],
  });

  const restoredSnapshot = await rootAgentRuntimeSnapshotRepository.load(
    ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  );
  if (restoredSnapshot) {
    await rootAgentRuntime.restorePersistedSnapshot(restoredSnapshot);
  }

  // 摸鱼判定重启回扫：从 ledger 读最近 2h（覆盖 30min 滑动窗 + 30min 不应期，富余充足）
  // 重建两组时间戳。失败只降级为「冷启动从零累积」，不阻塞 agent 启动。
  try {
    const innerVoiceLookbackMs = 2 * 60 * 60 * 1000;
    const recentLedgerRecords = await linearMessageLedgerDao.listCreatedAfter({
      runtimeKey: ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
      createdAfter: new Date(Date.now() - innerVoiceLookbackMs),
      limit: 20_000,
    });
    innerVoiceIdleTracker.restore(collectInnerVoiceIdleSignals(recentLedgerRecords));
  } catch (error) {
    logger.errorWithCause("Inner voice idle tracker restore failed; starting cold", error, {
      event: "agent.inner_voice.restore_failed",
    });
  }

  const llmProviderService = new DefaultLlmProviderService({ llmClient });
  const mainAgentContextQueryService = new DefaultMainAgentContextQueryService({
    rootAgentRuntime,
  });

  return {
    rootAgentRuntime,
    mainAgentContextQueryService,
    llmProviderService,
    todoSuggestionTaskAgent,
    qqApp,
    qqOutboundService,
    shutdownApps: () => appManager.shutdownAll(),
  };
}
