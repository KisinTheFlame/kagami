import {
  BaseLoopAgent,
  type LoopAgentExtension,
  ReActKernel,
  type ReActKernelRunRoundInput,
  type ReActRoundResult,
  SerialExecutor,
  type ToolExecutor,
  type ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type {
  AgentContext,
  AgentContextDashboardSummary,
  AgentContextSnapshot,
  AssistantMessage,
} from "../context/agent-context.js";
import {
  createConversationSummaryMessage,
  createWakeReminderMessage,
} from "../context/context-message-factory.js";
import { createContextCompactionPlan } from "../context/context-compaction.js";
import type { Event } from "../event/event.js";
import type { AgentEventQueue } from "../event/event.queue.js";
import type { LlmClient } from "../../../llm/client.js";
import type { LlmMessage, Tool } from "../../../llm/types.js";
import { AppLogger } from "../../../logger/logger.js";
import type { MetricService } from "../../../metric/application/metric.service.js";
import type { ContextSummaryOperation } from "../../capabilities/context-summary/operations/context-summary.operation.js";
import {
  DEFAULT_LLM_RETRY_BACKOFF_MS,
  FixedRetryBackoffPolicy,
  isRetryableLlmFailure,
  LoopLlmRetryExtension,
} from "../llm-retry.js";
import type { RootAgentRuntimeSnapshotRepository } from "./persistence/root-agent-runtime-snapshot.repository.js";
import {
  ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  ROOT_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
} from "./persistence/root-agent-runtime-snapshot.repository.js";
import type { PersistedRootAgentRuntimeSnapshot } from "./persistence/root-agent-runtime-snapshot.js";
import { NOOP_METRIC_SERVICE, recordToolCallMetric } from "../tool-call-metric.js";
import type {
  RootAgentPostToolEffects,
  RootAgentSessionController,
  RootAgentSessionDashboardSnapshot,
} from "./session/root-agent-session.js";
import type { RootAgentInvokeToolName } from "./session/state.types.js";
import { WAIT_TOOL_NAME } from "./tools/wait.tool.js";
import { ContextCompactionExtension } from "./extensions/context-compaction.extension.js";
import type { RootAgentExtensionHost } from "./extensions/extension-host.js";
import { RootLlmTelemetryExtension } from "./extensions/llm-telemetry.extension.js";
import { RootPostToolEffectsExtension } from "./extensions/post-tool-effects.extension.js";
import { SnapshotPersistenceExtension } from "./extensions/snapshot-persistence.extension.js";
import { RootToolExecutionStateExtension } from "./extensions/tool-execution-state.extension.js";
import { RootToolFallbackExtension } from "./extensions/tool-fallback.extension.js";
import { WakeReminderExtension } from "./extensions/wake-reminder.extension.js";

type ContextSummaryLike =
  | Pick<ContextSummaryOperation, "execute">
  | {
      summarize(input: {
        systemPrompt: string;
        messages: import("../../../llm/types.js").LlmMessage[];
        tools: Tool[];
      }): Promise<string | null>;
    };

type RootLoopExtension = LoopAgentExtension<
  RootLoopExtensionContext,
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
>;

type RootAgentRuntimeDeps = {
  llmClient: LlmClient;
  context: AgentContext;
  eventQueue: AgentEventQueue;
  session: RootAgentSessionController;
  snapshotRepository?: RootAgentRuntimeSnapshotRepository;
  runtimeKey?: string;
  tools?: ToolExecutor<LlmMessage>;
  agentTools?: ToolExecutor<LlmMessage>;
  contextSummaryOperation?: ContextSummaryLike;
  summaryPlanner?: ContextSummaryLike;
  summaryTools?: Tool[];
  contextCompactionTotalTokenThreshold?: number;
  metricService?: MetricService;
  llmRetryBackoffMs?: number;
  loopExtensions?: RootLoopExtension[];
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_CONTEXT_COMPACTION_TOTAL_TOKEN_THRESHOLD = 150_000;
const DEFAULT_DASHBOARD_CONTEXT_LIMIT = 40;
const DEFAULT_DASHBOARD_PREVIEW_LENGTH = 160;
const logger = new AppLogger({ source: "agent.root-agent-runtime" });

type PendingToolPersistence = {
  toolResult?: {
    toolCallId: string;
    content: string;
  };
  postToolEffects: RootAgentPostToolEffects;
};

export type RootAgentToolExecutionData = {
  postToolEffects: RootAgentPostToolEffects;
};

export type RootAgentCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

export type RootLoopExtensionContext = {
  host: Pick<
    RootAgentExtensionHost,
    | "appendWakeReminderIfNeeded"
    | "compactContextIfNeeded"
    | "persistSnapshotIfChanged"
    | "getContextSnapshot"
    | "appendMessages"
  >;
  notifyContextCompacted: () => Promise<void>;
};

export type RootAgentLoopState =
  | "starting"
  | "idle"
  | "consuming_events"
  | "calling_llm"
  | "executing_tool"
  | "crashed";

export type RootAgentRuntimeErrorSummary = {
  name: string;
  message: string;
  updatedAt: Date;
};

export type RootAgentToolCallSummary = {
  name: string;
  argumentsPreview: string;
  updatedAt: Date;
};

export type RootAgentLlmCallSummary = {
  provider: string;
  model: string;
  assistantContentPreview: string;
  toolCallNames: string[];
  totalTokens: number | null;
  updatedAt: Date;
};

export type RootAgentRuntimeDashboardSnapshot = {
  initialized: boolean;
  loopState: RootAgentLoopState;
  lastError: RootAgentRuntimeErrorSummary | null;
  lastActivityAt: Date | null;
  lastRoundCompletedAt: Date | null;
  lastCompactionAt: Date | null;
  contextCompactionTotalTokenThreshold: number;
  contextSummary: AgentContextDashboardSummary;
  lastToolCall: RootAgentToolCallSummary | null;
  lastToolResultPreview: string | null;
  lastLlmCall: RootAgentLlmCallSummary | null;
  session: RootAgentSessionDashboardSnapshot;
  availableInvokeTools: RootAgentInvokeToolName[];
};

class RootAgentHost implements RootAgentExtensionHost {
  private readonly context: AgentContext;
  private readonly eventQueue: AgentEventQueue;
  private readonly session: RootAgentSessionController;
  private readonly snapshotRepository?: RootAgentRuntimeSnapshotRepository;
  private readonly runtimeKey: string;
  private readonly contextSummaryOperation?: ContextSummaryLike;
  private readonly summaryTools: Tool[];
  private readonly contextCompactionTotalTokenThreshold: number;
  private readonly llmRetryBackoffMs: number;
  private readonly metricService: MetricService;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastWakeReminderAt: Date | null = null;
  private initialized = false;
  private loopState: RootAgentLoopState = "starting";
  private lastError: RootAgentRuntimeErrorSummary | null = null;
  private lastActivityAt: Date | null = null;
  private lastRoundCompletedAt: Date | null = null;
  private lastCompactionAt: Date | null = null;
  private lastToolCall: RootAgentToolCallSummary | null = null;
  private lastToolResultPreview: string | null = null;
  private lastLlmCall: RootAgentLlmCallSummary | null = null;
  private lastPersistedSnapshotFingerprint: string | null = null;
  private readonly mutationExecutor = new SerialExecutor();

  public constructor({
    context,
    eventQueue,
    session,
    snapshotRepository,
    runtimeKey,
    contextSummaryOperation,
    summaryPlanner,
    summaryTools,
    contextCompactionTotalTokenThreshold,
    metricService,
    llmRetryBackoffMs,
    now,
    sleep,
  }: Omit<RootAgentRuntimeDeps, "llmClient" | "tools" | "agentTools">) {
    this.context = context;
    this.eventQueue = eventQueue;
    this.session = session;
    this.snapshotRepository = snapshotRepository;
    this.runtimeKey = runtimeKey ?? ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY;
    this.contextSummaryOperation = contextSummaryOperation ?? summaryPlanner;
    this.summaryTools = summaryTools ?? [];
    this.contextCompactionTotalTokenThreshold =
      contextCompactionTotalTokenThreshold ?? DEFAULT_CONTEXT_COMPACTION_TOTAL_TOKEN_THRESHOLD;
    this.metricService = metricService ?? NOOP_METRIC_SERVICE;
    this.llmRetryBackoffMs = llmRetryBackoffMs ?? DEFAULT_LLM_RETRY_BACKOFF_MS;
    this.now = now ?? (() => new Date());
    this.sleep = sleep ?? createSleep;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.transitionTo("starting");

    try {
      await this.mutationExecutor.submit(async () => {
        if (this.initialized) {
          return;
        }

        await this.session.initializeContext();
        this.initialized = true;
        this.touchActivity();
        this.transitionTo("idle");
      });
    } catch (error) {
      this.recordCrash(error);
      throw error;
    }
  }

  public async restorePersistedSnapshot(
    snapshot: PersistedRootAgentRuntimeSnapshot,
  ): Promise<void> {
    await this.mutationExecutor.submit(async () => {
      await this.context.restorePersistedSnapshot(snapshot.contextSnapshot);
      this.session.restorePersistedSnapshot(snapshot.sessionSnapshot);
      const pendingEffectsResult = await this.session.flushPendingIncomingEffects();
      this.lastWakeReminderAt = cloneDate(snapshot.lastWakeReminderAt);
      this.lastPersistedSnapshotFingerprint = createSnapshotFingerprint(snapshot);
      if (pendingEffectsResult.shouldTriggerRound) {
        this.touchActivity();
      }
      this.transitionTo("idle");
    });
  }

  public async resetContext(): Promise<{ resetAt: Date }> {
    const resetAt = this.now();
    await this.mutationExecutor.submit(async () => {
      await this.deletePersistedSnapshot();
      this.eventQueue.clear();
      await this.context.reset();
      this.session.reset();
      this.resetRuntimeState(resetAt);
      await this.session.initializeContext();
      this.initialized = true;
      this.transitionTo("idle");
    });

    return {
      resetAt: new Date(resetAt),
    };
  }

  public async hydrateStartupEvents(events: Event[]): Promise<void> {
    await this.mutationExecutor.submit(async () => {
      for (const event of events) {
        await this.session.consumeIncomingEvent(event);
      }
      await this.session.flushPendingIncomingEffects();
      if (events.length > 0) {
        this.touchActivity();
      }
    });
  }

  public async getDashboardSnapshot(): Promise<RootAgentRuntimeDashboardSnapshot> {
    const sessionSnapshot = await this.session.getDashboardSnapshot();

    return {
      initialized: this.initialized,
      loopState: this.loopState,
      lastError: cloneErrorSummary(this.lastError),
      lastActivityAt: cloneDate(this.lastActivityAt),
      lastRoundCompletedAt: cloneDate(this.lastRoundCompletedAt),
      lastCompactionAt: cloneDate(this.lastCompactionAt),
      contextCompactionTotalTokenThreshold: this.contextCompactionTotalTokenThreshold,
      contextSummary: await this.context.getDashboardSummary({
        limit: DEFAULT_DASHBOARD_CONTEXT_LIMIT,
        previewLength: DEFAULT_DASHBOARD_PREVIEW_LENGTH,
      }),
      lastToolCall: cloneToolCallSummary(this.lastToolCall),
      lastToolResultPreview: this.lastToolResultPreview,
      lastLlmCall: cloneLlmCallSummary(this.lastLlmCall),
      session: sessionSnapshot,
      availableInvokeTools: this.session.getAvailableInvokeTools(),
    };
  }

  public getSessionState() {
    return this.session.getState();
  }

  public transitionTo(loopState: RootAgentLoopState): void {
    this.loopState = loopState;
  }

  public async consumePendingEvents(): Promise<{ shouldTriggerRound: boolean }> {
    return await this.mutationExecutor.submit(async () => {
      this.transitionTo("consuming_events");
      let consumedEventCount = 0;

      while (true) {
        const event = this.eventQueue.dequeue();
        if (!event) {
          break;
        }

        await this.session.consumeIncomingEvent(event);
        consumedEventCount += 1;
      }

      const result = await this.session.flushPendingIncomingEffects();
      if (consumedEventCount > 0 || result.shouldTriggerRound) {
        this.touchActivity();
      }

      return {
        shouldTriggerRound: result.shouldTriggerRound,
      };
    });
  }

  public async createRoundInput(
    tools: ToolExecutor<LlmMessage>,
  ): Promise<ReActKernelRunRoundInput<LlmMessage, "agent">> {
    const snapshot = await this.context.getSnapshot();
    this.transitionTo("calling_llm");

    return {
      state: {
        systemPrompt: snapshot.systemPrompt,
        messages: [...snapshot.messages],
      },
      tools,
      toolContext: {
        chatTarget: this.session.getCurrentChatTarget(),
        systemPrompt: snapshot.systemPrompt,
        messages: [...snapshot.messages],
        agentContext: this.context,
        rootAgentSession: this.session,
      } as ReActKernelRunRoundInput<LlmMessage, "agent">["toolContext"],
      usage: "agent",
    };
  }

  public async flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects> {
    return await this.session.flushPendingPostToolEffects();
  }

  public async commitRoundResult(
    result: ReActRoundResult<LlmMessage, RootAgentCompletion, RootAgentToolExecutionData>,
    tools: ToolExecutor<LlmMessage>,
  ): Promise<void> {
    const persistentAssistantMessage = omitControlToolCalls(result.assistantMessage, tools);
    const assistantToPersist = shouldPersistAssistantMessage(persistentAssistantMessage)
      ? persistentAssistantMessage
      : null;
    const toolPersistences: PendingToolPersistence[] = result.toolExecutions.map(execution => ({
      ...(shouldPersistToolResultInContext({
        toolName: execution.toolCall.name,
        toolResult: execution.result,
      }) && execution.result.content.length > 0
        ? {
            toolResult: {
              toolCallId: execution.toolCall.id,
              content: execution.result.content,
            },
          }
        : {}),
      postToolEffects: execution.extensionData?.postToolEffects ?? {
        messages: [],
        events: [],
      },
    }));

    await this.mutationExecutor.submit(async () => {
      await this.persistRoundState({
        assistantMessage: assistantToPersist,
        toolPersistences,
      });
      this.lastRoundCompletedAt = this.now();
      this.touchActivity();
      this.transitionTo("idle");
    });
  }

  public async appendWakeReminderIfNeeded(): Promise<void> {
    const now = this.now();
    await this.mutationExecutor.submit(async () => {
      if (isSameWakeReminderMinute(this.lastWakeReminderAt, now)) {
        return;
      }

      await this.context.appendMessages([createWakeReminderMessage(now)]);
      this.lastWakeReminderAt = new Date(now);
      this.touchActivity();
      await this.persistSnapshotIfChanged();
    });
  }

  public async getContextSnapshot(): Promise<AgentContextSnapshot> {
    return await this.context.getSnapshot();
  }

  public async appendMessages(messages: LlmMessage[]): Promise<void> {
    await this.mutationExecutor.submit(async () => {
      await this.context.appendMessages(messages);
      this.touchActivity();
    });
  }

  public recordCrash(error: unknown): void {
    this.loopState = "crashed";
    this.lastError = {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      updatedAt: this.now(),
    };
    this.touchActivity();
  }

  public recordRecoverableError(error: unknown): void {
    this.lastError = {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      updatedAt: this.now(),
    };
    this.touchActivity();
  }

  public recordLlmCall(completion: RootAgentCompletion): void {
    this.clearRecoverableError();
    this.lastLlmCall = {
      provider: completion.provider,
      model: completion.model,
      assistantContentPreview: createPreview(completion.message.content),
      toolCallNames: completion.message.toolCalls.map(toolCall => toolCall.name),
      totalTokens: completion.usage?.totalTokens ?? null,
      updatedAt: this.now(),
    };
    this.touchActivity();
  }

  public recordToolCall(input: {
    toolName: string;
    argumentsValue: Record<string, unknown>;
    resultContent: string;
  }): void {
    void recordToolCallMetric({
      metricService: this.metricService,
      runtime: "agent",
      toolName: input.toolName,
      argumentsValue: input.argumentsValue,
    });

    this.lastToolCall = {
      name: input.toolName,
      argumentsPreview: createPreview(safeJsonStringify(input.argumentsValue)),
      updatedAt: this.now(),
    };
    this.lastToolResultPreview =
      input.resultContent.trim().length > 0 ? createPreview(input.resultContent) : null;
    this.touchActivity();
  }

  private async persistRoundState(input: {
    assistantMessage: AssistantMessage | null;
    toolPersistences: PendingToolPersistence[];
  }): Promise<void> {
    if (input.assistantMessage) {
      await this.context.appendAssistantTurn(input.assistantMessage);
    }

    for (const toolPersistence of input.toolPersistences) {
      if (toolPersistence.toolResult) {
        await this.context.appendToolResult(toolPersistence.toolResult);
      }

      if (toolPersistence.postToolEffects.messages.length > 0) {
        await this.context.appendMessages(toolPersistence.postToolEffects.messages);
      }

      if (toolPersistence.postToolEffects.events.length > 0) {
        await this.context.appendEvents(toolPersistence.postToolEffects.events);
      }
    }
  }

  public async compactContextIfNeeded(totalTokens: number | null | undefined): Promise<boolean> {
    if (!this.contextSummaryOperation) {
      return false;
    }

    if (typeof totalTokens !== "number") {
      try {
        logger.warn("Skipping context summary because totalTokens is missing", {
          event: "agent.root_agent_runtime.context_summary_skipped_missing_total_tokens",
        });
      } catch {
        // Ignore logger runtime setup gaps in tests and early boot.
      }
      return false;
    }

    while (true) {
      const snapshot = await this.context.getSnapshot();
      const compactionPlan = createContextCompactionPlan({
        messages: snapshot.messages,
        totalTokens,
        totalTokenThreshold: this.contextCompactionTotalTokenThreshold,
      });
      if (!compactionPlan) {
        return false;
      }

      let summary;
      try {
        summary =
          "execute" in this.contextSummaryOperation
            ? await this.contextSummaryOperation.execute({
                systemPrompt: snapshot.systemPrompt,
                messages: compactionPlan.messagesToSummarize,
                tools: this.summaryTools,
              })
            : await this.contextSummaryOperation.summarize({
                systemPrompt: snapshot.systemPrompt,
                messages: compactionPlan.messagesToSummarize,
                tools: this.summaryTools,
              });
      } catch (error) {
        if (!isRetryableLlmFailure(error)) {
          throw error;
        }

        this.recordRecoverableError(error);
        logger.warn("Context summary failed; scheduling retry", {
          event: "agent.root_agent_runtime.context_summary_retry_scheduled",
          retryBackoffMs: this.llmRetryBackoffMs,
          errorName: error instanceof Error ? error.name : "Error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        await this.sleep(this.llmRetryBackoffMs);
        continue;
      }

      this.clearRecoverableError();
      if (!summary) {
        return false;
      }

      await this.context.replaceMessages([
        createConversationSummaryMessage(summary),
        ...compactionPlan.messagesToKeep,
      ]);
      this.lastCompactionAt = this.now();
      this.touchActivity();
      return true;
    }
  }

  public async persistSnapshotIfChanged(input?: { suppressError?: boolean }): Promise<void> {
    if (!this.snapshotRepository) {
      return;
    }

    const snapshot = await this.createPersistedSnapshot();
    const fingerprint = createSnapshotFingerprint(snapshot);
    if (fingerprint === this.lastPersistedSnapshotFingerprint) {
      return;
    }

    try {
      await this.snapshotRepository.save(snapshot);
      this.lastPersistedSnapshotFingerprint = fingerprint;
    } catch (error) {
      logger.errorWithCause("Failed to persist root agent runtime snapshot", error, {
        event: "agent.root_agent_runtime_snapshot.persist_failed",
        runtimeKey: this.runtimeKey,
      });
      if (input?.suppressError === false) {
        throw error;
      }
    }
  }

  private async createPersistedSnapshot(): Promise<PersistedRootAgentRuntimeSnapshot> {
    return {
      runtimeKey: this.runtimeKey,
      schemaVersion: ROOT_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
      contextSnapshot: await this.context.exportPersistedSnapshot(),
      sessionSnapshot: this.session.exportPersistedSnapshot(),
      lastWakeReminderAt: cloneDate(this.lastWakeReminderAt),
    };
  }

  private async deletePersistedSnapshot(): Promise<void> {
    if (!this.snapshotRepository) {
      this.lastPersistedSnapshotFingerprint = null;
      return;
    }

    try {
      await this.snapshotRepository.delete(this.runtimeKey);
      this.lastPersistedSnapshotFingerprint = null;
    } catch (error) {
      logger.errorWithCause("Failed to delete root agent runtime snapshot", error, {
        event: "agent.root_agent_runtime_snapshot.delete_failed",
        runtimeKey: this.runtimeKey,
      });
      throw error;
    }
  }

  private resetRuntimeState(resetAt: Date): void {
    this.lastWakeReminderAt = null;
    this.initialized = false;
    this.lastError = null;
    this.lastActivityAt = new Date(resetAt);
    this.lastRoundCompletedAt = null;
    this.lastCompactionAt = null;
    this.lastToolCall = null;
    this.lastToolResultPreview = null;
    this.lastLlmCall = null;
    this.lastPersistedSnapshotFingerprint = null;
    this.transitionTo("starting");
  }

  private touchActivity(): void {
    this.lastActivityAt = this.now();
  }

  private clearRecoverableError(): void {
    this.lastError = null;
  }
}

export class RootLoopAgent extends BaseLoopAgent<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext
> {
  private readonly host: RootAgentHost;
  private readonly tools: ToolExecutor<LlmMessage>;
  private readonly eventQueue: AgentEventQueue;
  private pendingResetPromise: Promise<{ resetAt: Date }> | null = null;

  public constructor({
    llmClient,
    tools,
    agentTools,
    llmRetryBackoffMs,
    sleep,
    eventQueue,
    loopExtensions,
    ...rest
  }: RootAgentRuntimeDeps) {
    const resolvedSleep = sleep ?? createSleep;
    const resolvedRetryBackoffMs = llmRetryBackoffMs ?? DEFAULT_LLM_RETRY_BACKOFF_MS;
    const resolvedTools = tools ?? agentTools ?? failMissingTools();
    const host = new RootAgentHost({
      ...rest,
      eventQueue,
      llmRetryBackoffMs: resolvedRetryBackoffMs,
      sleep: resolvedSleep,
    });
    const kernel = new ReActKernel<
      LlmMessage,
      "agent",
      RootAgentCompletion,
      RootAgentToolExecutionData
    >({
      model: llmClient,
      extensions: [
        new RootLlmTelemetryExtension({
          host,
        }),
        new LoopLlmRetryExtension({
          backoffPolicy: new FixedRetryBackoffPolicy(resolvedRetryBackoffMs),
          sleep: resolvedSleep,
          onRecoverableError: error => {
            host.recordRecoverableError(error);
            host.transitionTo("idle");
          },
          onBeforeRetry: ({ error, delayMs }) => {
            logger.warn("Root agent LLM call failed; scheduling retry", {
              event: "agent.root_agent_runtime.llm_retry_scheduled",
              retryBackoffMs: delayMs,
              errorName: error instanceof Error ? error.name : "Error",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          },
        }),
        new RootToolExecutionStateExtension({
          host,
        }),
        new RootToolFallbackExtension({
          host,
        }),
        new RootPostToolEffectsExtension({
          host,
        }),
      ],
    });

    super({
      kernel,
      extensions: [
        new WakeReminderExtension(),
        new ContextCompactionExtension(),
        ...(loopExtensions ?? []),
        new SnapshotPersistenceExtension(),
      ],
    });

    this.host = host;
    this.tools = resolvedTools;
    this.eventQueue = eventQueue;
  }

  public async run(): Promise<void> {
    await this.start();
  }

  public async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  public async restorePersistedSnapshot(
    snapshot: PersistedRootAgentRuntimeSnapshot,
  ): Promise<void> {
    await this.host.restorePersistedSnapshot(snapshot);
  }

  public async resetContext(): Promise<{ resetAt: Date }> {
    if (this.pendingResetPromise) {
      return await this.pendingResetPromise;
    }

    const resetPromise = (async () => {
      // Push a wake event so that if the current runOnce is blocked inside
      // the wait tool, it unblocks and the loop iteration can finish.
      this.eventQueue.enqueue({ type: "wake" });
      await this.waitForActiveRunOnce();

      const result = await this.host.resetContext();
      await this.notifyAfterReset();
      return result;
    })();

    this.pendingResetPromise = resetPromise;

    try {
      return await resetPromise;
    } finally {
      if (this.pendingResetPromise === resetPromise) {
        this.pendingResetPromise = null;
      }
    }
  }

  public async hydrateStartupEvents(events: Event[]): Promise<void> {
    await this.host.hydrateStartupEvents(events);
  }

  public async getDashboardSnapshot(): Promise<RootAgentRuntimeDashboardSnapshot> {
    return await this.host.getDashboardSnapshot();
  }

  protected override async initializeHostIfNeeded(): Promise<void> {
    await this.host.initialize();
  }

  protected override createLoopExtensionContext(): RootLoopExtensionContext {
    return {
      host: this.host,
      notifyContextCompacted: () => this.notifyContextCompacted(),
    };
  }

  protected override onStopRequested(): void {
    // Unblock any tool currently awaiting eventQueue.waitNonEmpty() so the
    // round can end and the loop can notice stopRequested.
    this.eventQueue.enqueue({ type: "wake" });
  }

  protected override async runOnce(): Promise<void> {
    await this.awaitPendingReset();

    // Step 1: drain any events in the queue into the context. This is the
    // moment where wake events get silently consumed (session routes them
    // to a no-op), napcat messages get routed to their state, etc.
    await this.host.consumePendingEvents();
    await this.awaitPendingReset();

    // Step 2: run one ReAct round. The LLM may call blocking tools like
    // wait / finish_story_batch; those block inside eventQueue.waitNonEmpty
    // until a producer (real event or timer-enqueued wake) resolves them.
    await this.runReactRound();
  }

  protected override async buildRoundInput(): Promise<ReActKernelRunRoundInput<
    LlmMessage,
    "agent"
  > | null> {
    return await this.host.createRoundInput(this.tools);
  }

  protected override async commitRoundResult(
    result: ReActRoundResult<LlmMessage, RootAgentCompletion, RootAgentToolExecutionData>,
  ): Promise<void> {
    await this.host.commitRoundResult(result, this.tools);
  }

  protected override async onUnhandledError(error: unknown): Promise<void> {
    this.host.recordCrash(error);
  }

  private async awaitPendingReset(): Promise<void> {
    const pendingResetPromise = this.pendingResetPromise;
    if (!pendingResetPromise) {
      return;
    }

    await pendingResetPromise.catch(() => undefined);
  }
}

async function createSleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function failMissingTools(): never {
  throw new Error("RootLoopAgent requires tools");
}

function omitControlToolCalls(
  message: AssistantMessage,
  agentTools: ToolExecutor<LlmMessage>,
): AssistantMessage {
  return {
    ...message,
    toolCalls: message.toolCalls.filter(
      toolCall =>
        agentTools.getKind(toolCall.name) !== "control" ||
        shouldPersistControlToolInContext(toolCall.name),
    ),
  };
}

function shouldPersistToolResultInContext(input: {
  toolName: string;
  toolResult: ToolSetExecutionResult;
}): boolean {
  return input.toolResult.kind !== "control" || shouldPersistControlToolInContext(input.toolName);
}

function shouldPersistControlToolInContext(toolName: string): boolean {
  return toolName === WAIT_TOOL_NAME;
}

function shouldPersistAssistantMessage(message: AssistantMessage): boolean {
  return message.content.trim().length > 0 || message.toolCalls.length > 0;
}

function isSameWakeReminderMinute(previous: Date | null, current: Date): boolean {
  if (previous === null) {
    return false;
  }

  return createWakeReminderMinuteKey(previous) === createWakeReminderMinuteKey(current);
}

function createWakeReminderMinuteKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return [values.year, values.month, values.day, values.hour, values.minute].join("-");
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function cloneErrorSummary(
  value: RootAgentRuntimeErrorSummary | null,
): RootAgentRuntimeErrorSummary | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    updatedAt: new Date(value.updatedAt),
  };
}

function cloneToolCallSummary(
  value: RootAgentToolCallSummary | null,
): RootAgentToolCallSummary | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    updatedAt: new Date(value.updatedAt),
  };
}

function cloneLlmCallSummary(
  value: RootAgentLlmCallSummary | null,
): RootAgentLlmCallSummary | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    updatedAt: new Date(value.updatedAt),
  };
}

function safeJsonStringify(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function createPreview(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= DEFAULT_DASHBOARD_PREVIEW_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, DEFAULT_DASHBOARD_PREVIEW_LENGTH - 1)}…`;
}

function createSnapshotFingerprint(snapshot: PersistedRootAgentRuntimeSnapshot): string {
  return JSON.stringify({
    runtimeKey: snapshot.runtimeKey,
    schemaVersion: snapshot.schemaVersion,
    contextSnapshot: snapshot.contextSnapshot,
    sessionSnapshot: snapshot.sessionSnapshot,
    lastWakeReminderAt: snapshot.lastWakeReminderAt?.toISOString() ?? null,
  });
}
