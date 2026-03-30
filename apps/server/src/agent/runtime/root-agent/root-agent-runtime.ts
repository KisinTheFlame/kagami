import {
  BaseLoopAgent,
  type LoopAgentExtension,
  ReActKernel,
  type ReActKernelExtension,
  type ReActKernelRunRoundInput,
  type ReActRoundResult,
  type ToolExecutor,
  type ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type {
  AgentContext,
  AgentContextDashboardSummary,
  AssistantMessage,
} from "../context/agent-context.js";
import {
  createConversationSummaryMessage,
  createMessagesFromEvent,
  createWakeReminderMessage,
} from "../context/context-message-factory.js";
import type { Event } from "../event/event.js";
import type { AgentEventQueue } from "../event/event.queue.js";
import { BizError } from "../../../common/errors/biz-error.js";
import type { LlmClient } from "../../../llm/client.js";
import type { LlmMessage, Tool } from "../../../llm/types.js";
import { AppLogger } from "../../../logger/logger.js";
import type { ContextSummaryOperation } from "../../capabilities/context-summary/operations/context-summary.operation.js";
import type { RootAgentRuntimeSnapshotRepository } from "./persistence/root-agent-runtime-snapshot.repository.js";
import {
  ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  ROOT_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
} from "./persistence/root-agent-runtime-snapshot.repository.js";
import type { PersistedRootAgentRuntimeSnapshot } from "./persistence/root-agent-runtime-snapshot.js";
import type {
  RootAgentInvokeToolName,
  RootAgentPostToolEffects,
  RootAgentSessionController,
  RootAgentSessionDashboardSnapshot,
} from "./session/root-agent-session.js";
import { WAIT_TOOL_NAME } from "./tools/wait.tool.js";

type ContextSummaryLike =
  | Pick<ContextSummaryOperation, "execute">
  | {
      summarize(input: {
        messages: import("../../../llm/types.js").LlmMessage[];
        tools: Tool[];
      }): Promise<string | null>;
    };

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
  contextCompactionThreshold?: number;
  llmRetryBackoffMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_CONTEXT_COMPACTION_THRESHOLD = 60;
const CONTEXT_COMPACTION_KEEP_RATIO = 0.1;
const DEFAULT_LLM_RETRY_BACKOFF_MS = 30_000;
const DEFAULT_DASHBOARD_CONTEXT_LIMIT = 40;
const DEFAULT_DASHBOARD_PREVIEW_LENGTH = 160;
const IDLE_SLEEP_MS = 10;
const logger = new AppLogger({ source: "agent.root-agent-runtime" });

type PendingToolPersistence = {
  toolResult?: {
    toolCallId: string;
    content: string;
  };
  postToolEffects: RootAgentPostToolEffects;
};

type ContextCompactionPlan = {
  messagesToSummarize: LlmMessage[];
  messagesToKeep: LlmMessage[];
};

type RootAgentToolExecutionData = {
  postToolEffects: RootAgentPostToolEffects;
};

type RootAgentCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

type RootLoopExtensionContext = {
  host: Pick<
    RootAgentHost,
    "appendWakeReminderIfNeeded" | "compactContextIfNeeded" | "persistSnapshotIfChanged"
  >;
};

export type RootAgentLoopState =
  | "starting"
  | "idle"
  | "consuming_events"
  | "calling_llm"
  | "executing_tool"
  | "waiting"
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
  updatedAt: Date;
};

export type RootAgentRuntimeDashboardSnapshot = {
  initialized: boolean;
  loopState: RootAgentLoopState;
  lastError: RootAgentRuntimeErrorSummary | null;
  lastActivityAt: Date | null;
  lastRoundCompletedAt: Date | null;
  lastCompactionAt: Date | null;
  contextCompactionThreshold: number;
  contextSummary: AgentContextDashboardSummary;
  lastToolCall: RootAgentToolCallSummary | null;
  lastToolResultPreview: string | null;
  lastLlmCall: RootAgentLlmCallSummary | null;
  session: RootAgentSessionDashboardSnapshot;
  availableInvokeTools: RootAgentInvokeToolName[];
};

class RootAgentHost {
  private readonly context: AgentContext;
  private readonly eventQueue: AgentEventQueue;
  private readonly session: RootAgentSessionController;
  private readonly snapshotRepository?: RootAgentRuntimeSnapshotRepository;
  private readonly runtimeKey: string;
  private readonly contextSummaryOperation?: ContextSummaryLike;
  private readonly summaryTools: Tool[];
  private readonly contextCompactionThreshold: number;
  private readonly llmRetryBackoffMs: number;
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
  private serializedMutationChain: Promise<void> = Promise.resolve();

  public constructor({
    context,
    eventQueue,
    session,
    snapshotRepository,
    runtimeKey,
    contextSummaryOperation,
    summaryPlanner,
    summaryTools,
    contextCompactionThreshold,
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
    this.contextCompactionThreshold =
      contextCompactionThreshold ?? DEFAULT_CONTEXT_COMPACTION_THRESHOLD;
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
      await this.runSerializedMutation(async () => {
        if (this.initialized) {
          return;
        }

        await this.session.initializeContext();
        this.initialized = true;
        this.touchActivity();
        this.transitionTo(this.session.getState().kind === "waiting" ? "waiting" : "idle");
      });
    } catch (error) {
      this.recordCrash(error);
      throw error;
    }
  }

  public async restorePersistedSnapshot(
    snapshot: PersistedRootAgentRuntimeSnapshot,
  ): Promise<void> {
    await this.runSerializedMutation(async () => {
      await this.context.restorePersistedSnapshot(snapshot.contextSnapshot);
      this.session.restorePersistedSnapshot(snapshot.sessionSnapshot);
      const waitingTimeoutResult = await this.session.finishWaitingIfExpired(this.now());
      const pendingEffectsResult = await this.session.flushPendingIncomingEffects();
      this.lastWakeReminderAt = cloneDate(snapshot.lastWakeReminderAt);
      this.lastPersistedSnapshotFingerprint = createSnapshotFingerprint(snapshot);
      if (waitingTimeoutResult.shouldTriggerRound || pendingEffectsResult.shouldTriggerRound) {
        this.touchActivity();
      }
      this.transitionTo(this.session.getState().kind === "waiting" ? "waiting" : "idle");
    });
  }

  public async resetContext(): Promise<{ resetAt: Date }> {
    const resetAt = this.now();
    await this.runSerializedMutation(async () => {
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
    await this.runSerializedMutation(async () => {
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
    const sessionSnapshot =
      this.session.getDashboardSnapshot?.() ?? createSessionDashboardSnapshot(this.session);

    return {
      initialized: this.initialized,
      loopState: this.loopState,
      lastError: cloneErrorSummary(this.lastError),
      lastActivityAt: cloneDate(this.lastActivityAt),
      lastRoundCompletedAt: cloneDate(this.lastRoundCompletedAt),
      lastCompactionAt: cloneDate(this.lastCompactionAt),
      contextCompactionThreshold: this.contextCompactionThreshold,
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

  public async consumePendingEvents(input?: {
    allowWaitingTimeout?: boolean;
  }): Promise<{ shouldTriggerRound: boolean }> {
    return await this.runSerializedMutation(async () => {
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

      const waitingTimeoutResult =
        input?.allowWaitingTimeout === false
          ? { shouldTriggerRound: false }
          : await this.session.finishWaitingIfExpired(this.now());
      const result = await this.session.flushPendingIncomingEffects();
      if (
        consumedEventCount > 0 ||
        waitingTimeoutResult.shouldTriggerRound ||
        result.shouldTriggerRound
      ) {
        this.touchActivity();
      }

      return {
        shouldTriggerRound: result.shouldTriggerRound || waitingTimeoutResult.shouldTriggerRound,
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
        groupId: this.session.getCurrentGroupId(),
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

    await this.runSerializedMutation(async () => {
      await this.persistRoundState({
        assistantMessage: assistantToPersist,
        toolPersistences,
      });
      this.lastRoundCompletedAt = this.now();
      this.touchActivity();
      this.transitionTo(this.session.getState().kind === "waiting" ? "waiting" : "idle");
    });
  }

  public async appendWakeReminderIfNeeded(): Promise<void> {
    const now = this.now();
    await this.runSerializedMutation(async () => {
      if (isSameWakeReminderMinute(this.lastWakeReminderAt, now)) {
        return;
      }

      await this.context.appendMessages([createWakeReminderMessage(now)]);
      this.lastWakeReminderAt = new Date(now);
      this.touchActivity();
      await this.compactContextIfNeeded();
      await this.persistSnapshotIfChanged();
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
      updatedAt: this.now(),
    };
    this.touchActivity();
  }

  public recordToolCall(input: {
    toolName: string;
    argumentsValue: Record<string, unknown>;
    resultContent: string;
  }): void {
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

  public async compactContextIfNeeded(): Promise<void> {
    if (!this.contextSummaryOperation) {
      return;
    }

    while (true) {
      const snapshot = await this.context.getSnapshot();
      const compactionPlan = planContextCompaction({
        messages: snapshot.messages,
        threshold: this.contextCompactionThreshold,
      });
      if (!compactionPlan) {
        return;
      }

      let summary;
      try {
        summary =
          "execute" in this.contextSummaryOperation
            ? await this.contextSummaryOperation.execute({
                messages: compactionPlan.messagesToSummarize,
                tools: this.summaryTools,
              })
            : await this.contextSummaryOperation.summarize({
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
        return;
      }

      await this.context.replaceMessages([
        createConversationSummaryMessage(summary),
        ...compactionPlan.messagesToKeep,
      ]);
      this.lastCompactionAt = this.now();
      this.touchActivity();
      return;
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

  private async runSerializedMutation<T>(callback: () => Promise<T>): Promise<T> {
    const previous = this.serializedMutationChain;
    let releaseCurrent!: () => void;
    this.serializedMutationChain = new Promise<void>(resolve => {
      releaseCurrent = resolve;
    });

    await previous.catch(() => undefined);

    try {
      return await callback();
    } finally {
      releaseCurrent();
    }
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

class WakeReminderExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  public async onBeforeRound(context: RootLoopExtensionContext): Promise<void> {
    await context.host.appendWakeReminderIfNeeded();
  }
}

class ContextCompactionExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  public async onInitialize(context: RootLoopExtensionContext): Promise<void> {
    await context.host.compactContextIfNeeded();
  }

  public async onAfterEventsConsumed(input: { context: RootLoopExtensionContext }): Promise<void> {
    await input.context.host.compactContextIfNeeded();
  }

  public async onBeforeRound(context: RootLoopExtensionContext): Promise<void> {
    await context.host.compactContextIfNeeded();
  }

  public async onAfterCommit(input: { context: RootLoopExtensionContext }): Promise<void> {
    await input.context.host.compactContextIfNeeded();
  }

  public async onAfterReset(context: RootLoopExtensionContext): Promise<void> {
    await context.host.compactContextIfNeeded();
  }
}

class SnapshotPersistenceExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  public async onInitialize(context: RootLoopExtensionContext): Promise<void> {
    await context.host.persistSnapshotIfChanged();
  }

  public async onAfterEventsConsumed(input: { context: RootLoopExtensionContext }): Promise<void> {
    await input.context.host.persistSnapshotIfChanged();
  }

  public async onBeforeRound(context: RootLoopExtensionContext): Promise<void> {
    await context.host.persistSnapshotIfChanged();
  }

  public async onAfterCommit(input: { context: RootLoopExtensionContext }): Promise<void> {
    await input.context.host.persistSnapshotIfChanged();
  }

  public async onAfterReset(context: RootLoopExtensionContext): Promise<void> {
    await context.host.persistSnapshotIfChanged({
      suppressError: false,
    });
  }
}

class RootLlmTelemetryExtension implements ReActKernelExtension<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly host: RootAgentHost;

  public constructor({ host }: { host: RootAgentHost }) {
    this.host = host;
  }

  public onAfterModel(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "agent">;
    completion: RootAgentCompletion;
  }): void {
    this.host.recordLlmCall(input.completion);
  }
}

class RootLlmRetryExtension implements ReActKernelExtension<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly host: RootAgentHost;
  private readonly llmRetryBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor({
    host,
    llmRetryBackoffMs,
    sleep,
  }: {
    host: RootAgentHost;
    llmRetryBackoffMs: number;
    sleep: (ms: number) => Promise<void>;
  }) {
    this.host = host;
    this.llmRetryBackoffMs = llmRetryBackoffMs;
    this.sleep = sleep;
  }

  public async onModelError(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "agent">;
    error: unknown;
  }): Promise<{ handled: boolean; retry: boolean } | void> {
    if (!isRetryableLlmFailure(input.error)) {
      return;
    }

    this.host.recordRecoverableError(input.error);
    this.host.transitionTo("idle");
    logger.warn("Root agent LLM call failed; scheduling retry", {
      event: "agent.root_agent_runtime.llm_retry_scheduled",
      retryBackoffMs: this.llmRetryBackoffMs,
      errorName: input.error.name,
      errorMessage: input.error.message,
    });
    await this.sleep(this.llmRetryBackoffMs);

    return {
      handled: true,
      retry: true,
    };
  }
}

class RootToolExecutionStateExtension implements ReActKernelExtension<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly host: RootAgentHost;

  public constructor({ host }: { host: RootAgentHost }) {
    this.host = host;
  }

  public onBeforeToolExecution(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "agent">;
    completion: RootAgentCompletion;
    toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
  }): void {
    void input;
    this.host.transitionTo("executing_tool");
  }
}

class RootToolFallbackExtension implements ReActKernelExtension<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly host: RootAgentHost;

  public constructor({ host }: { host: RootAgentHost }) {
    this.host = host;
  }

  public async onToolError(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "agent">;
    toolCall: {
      name: string;
    };
    error: unknown;
  }): Promise<{ handled: boolean; result: ToolSetExecutionResult }> {
    this.host.recordRecoverableError(input.error);
    logger.warn("Root agent tool call failed; returning temporary failure result", {
      event: "agent.root_agent_runtime.tool_temporary_failure",
      toolName: input.toolCall.name,
      errorName: input.error instanceof Error ? input.error.name : "Error",
      errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
    });

    return {
      handled: true,
      result: createTemporaryToolFailureResult({
        toolName: input.toolCall.name,
        kind: input.request.tools.getKind(input.toolCall.name) ?? "business",
        error: input.error,
      }),
    };
  }
}

class RootPostToolEffectsExtension implements ReActKernelExtension<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly host: RootAgentHost;

  public constructor({ host }: { host: RootAgentHost }) {
    this.host = host;
  }

  public async onAfterToolExecution(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "agent">;
    completion: RootAgentCompletion;
    toolCall: {
      name: string;
      arguments: Record<string, unknown>;
    };
    result: ToolSetExecutionResult;
  }): Promise<{
    appendedMessages?: LlmMessage[];
    extensionData?: RootAgentToolExecutionData;
  }> {
    this.host.recordToolCall({
      toolName: input.toolCall.name,
      argumentsValue: input.toolCall.arguments,
      resultContent: input.result.content,
    });

    const postToolEffects = await this.host.flushPendingPostToolEffects();

    return {
      appendedMessages: [
        ...postToolEffects.messages,
        ...postToolEffects.events.flatMap(createMessagesFromEvent),
      ],
      extensionData: {
        postToolEffects,
      },
    };
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
  private shouldRunRoundFlag = true;
  private waitingNeedsSleep = false;
  private pendingResetPromise: Promise<{ resetAt: Date }> | null = null;

  public constructor({
    llmClient,
    tools,
    agentTools,
    llmRetryBackoffMs,
    sleep,
    ...rest
  }: RootAgentRuntimeDeps) {
    const resolvedSleep = sleep ?? createSleep;
    const resolvedRetryBackoffMs = llmRetryBackoffMs ?? DEFAULT_LLM_RETRY_BACKOFF_MS;
    const resolvedTools = tools ?? agentTools ?? failMissingTools();
    const host = new RootAgentHost({
      ...rest,
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
        new RootLlmRetryExtension({
          host,
          llmRetryBackoffMs: resolvedRetryBackoffMs,
          sleep: resolvedSleep,
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
        new SnapshotPersistenceExtension(),
      ],
      sleep: resolvedSleep,
    });

    this.host = host;
    this.tools = resolvedTools;
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
      await this.waitForActiveTick();

      this.shouldRunRoundFlag = false;
      this.waitingNeedsSleep = false;
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
    };
  }

  protected override async beforeTick(): Promise<{ shouldTriggerRound: boolean }> {
    await this.awaitPendingReset();
    const consumeResult = await this.host.consumePendingEvents({
      allowWaitingTimeout: !this.waitingNeedsSleep,
    });
    await this.awaitPendingReset();
    this.shouldRunRoundFlag = this.shouldRunRoundFlag || consumeResult.shouldTriggerRound;
    return consumeResult;
  }

  protected override async shouldRunRound(): Promise<boolean> {
    if (this.host.getSessionState().kind === "waiting") {
      this.host.transitionTo("waiting");
      return false;
    }

    if (!this.shouldRunRoundFlag) {
      this.host.transitionTo("idle");
      return false;
    }

    return true;
  }

  protected override async buildRoundInput(): Promise<ReActKernelRunRoundInput<
    LlmMessage,
    "agent"
  > | null> {
    this.shouldRunRoundFlag = false;
    return await this.host.createRoundInput(this.tools);
  }

  protected override async executeRound(
    input: ReActKernelRunRoundInput<LlmMessage, "agent">,
  ): Promise<ReActRoundResult<LlmMessage, RootAgentCompletion, RootAgentToolExecutionData>> {
    const result = await super.executeRound(input);
    this.shouldRunRoundFlag = result.shouldContinue || this.shouldRunRoundFlag;
    return result;
  }

  protected override async commitRoundResult(
    result: ReActRoundResult<LlmMessage, RootAgentCompletion, RootAgentToolExecutionData>,
  ): Promise<void> {
    await this.host.commitRoundResult(result, this.tools);
    this.waitingNeedsSleep = this.host.getSessionState().kind === "waiting";
  }

  protected override async afterTick(input: {
    didRunRound: boolean;
    roundResult: ReActRoundResult<
      LlmMessage,
      RootAgentCompletion,
      RootAgentToolExecutionData
    > | null;
  }): Promise<number> {
    if (this.host.getSessionState().kind !== "waiting") {
      this.waitingNeedsSleep = false;
    } else if (!input.didRunRound) {
      this.waitingNeedsSleep = false;
    }

    return input.didRunRound ? 0 : IDLE_SLEEP_MS;
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

function isRetryableLlmFailure(error: unknown): error is BizError {
  return (
    error instanceof BizError &&
    (error.message === "所选 LLM provider 当前不可用" || error.message === "LLM 上游服务调用失败")
  );
}

function createTemporaryToolFailureResult(input: {
  toolName: string;
  kind: ToolSetExecutionResult["kind"];
  error: unknown;
}): ToolSetExecutionResult {
  return {
    kind: input.kind,
    signal: "continue",
    content: JSON.stringify({
      ok: false,
      error: "TEMPORARY_TOOL_FAILURE",
      retryable: true,
      toolName: input.toolName,
      message: `工具 ${input.toolName} 暂时调用失败了，请稍后重试，或换一种方式继续。`,
      details: input.error instanceof Error ? input.error.message : String(input.error),
    }),
  };
}

function createSessionDashboardSnapshot(
  session: RootAgentSessionController,
): RootAgentSessionDashboardSnapshot {
  const state = session.getState();

  return {
    state:
      state.kind === "waiting"
        ? { kind: "waiting", deadlineAt: new Date(state.deadlineAt) }
        : state,
    currentGroupId: session.getCurrentGroupId() ?? null,
    waitingDeadlineAt: state.kind === "waiting" ? new Date(state.deadlineAt) : null,
    availableInvokeTools: session.getAvailableInvokeTools(),
    groups: [],
  };
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

function planContextCompaction(input: {
  messages: LlmMessage[];
  threshold: number;
}): ContextCompactionPlan | null {
  const { messages, threshold } = input;
  if (messages.length <= threshold) {
    return null;
  }

  const keepCount = calculateCompactionKeepCount({
    totalMessageCount: messages.length,
    threshold,
  });
  const initialCutIndex = messages.length - keepCount;
  const cutIndex = extendCompactionCutIndexForAssistantToolBoundary({
    messages,
    cutIndex: initialCutIndex,
  });

  return {
    messagesToSummarize: messages.slice(0, cutIndex),
    messagesToKeep: messages.slice(cutIndex),
  };
}

function calculateCompactionKeepCount(input: {
  totalMessageCount: number;
  threshold: number;
}): number {
  if (input.threshold <= 1) {
    return 0;
  }

  return Math.min(
    Math.max(1, Math.ceil(input.totalMessageCount * CONTEXT_COMPACTION_KEEP_RATIO)),
    input.threshold - 1,
  );
}

function extendCompactionCutIndexForAssistantToolBoundary(input: {
  messages: LlmMessage[];
  cutIndex: number;
}): number {
  const { messages, cutIndex } = input;
  if (cutIndex <= 0 || cutIndex >= messages.length) {
    return cutIndex;
  }

  const boundaryMessage = messages[cutIndex - 1];
  if (boundaryMessage?.role !== "assistant" || boundaryMessage.toolCalls.length === 0) {
    return cutIndex;
  }

  const toolCallIds = new Set(boundaryMessage.toolCalls.map(toolCall => toolCall.id));
  let lastMatchingToolIndex = -1;

  for (let index = cutIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "tool" && toolCallIds.has(message.toolCallId)) {
      lastMatchingToolIndex = index;
    }
  }

  return lastMatchingToolIndex >= 0 ? lastMatchingToolIndex + 1 : cutIndex;
}
