import {
  BaseLoopAgent,
  type Queue,
  type LoopAgentExtension,
  ReActKernel,
  ToolCatalog,
  type ReActKernelExtension,
  type ReActKernelRunRoundInput,
  type ReActRoundResult,
  type ToolContext,
  type ToolDefinition,
  type ToolExecutor,
  type ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type { StoryAgentEvent } from "./story-event.js";
import type {
  AgentContext,
  AgentContextDashboardSummary,
  AgentContextSnapshot,
} from "../../../runtime/context/agent-context.js";
import { DefaultAgentContext } from "../../../runtime/context/default-agent-context.js";
import { createContextCompactionPlan } from "../../../runtime/context/context-compaction.js";
import {
  createConversationSummaryMessage,
  createUserMessage,
} from "../../../runtime/context/context-message-factory.js";
import { renderLlmMessagePlainText } from "../../../runtime/context/context-item.utils.js";
import type { LlmClient } from "../../../../llm/client.js";
import type { LlmMessage, Tool } from "../../../../llm/types.js";
import { AppLogger } from "../../../../logger/logger.js";
import type { MetricService } from "../../../../metric/application/metric.service.js";
import type { ContextSummaryOperation } from "../../context-summary/operations/context-summary.operation.js";
import {
  DEFAULT_LLM_RETRY_BACKOFF_MS,
  FixedRetryBackoffPolicy,
  isRetryableLlmFailure,
  LoopLlmRetryExtension,
} from "../../../runtime/llm-retry.js";
import { StoryService } from "../application/story.service.js";
import type { LinearMessageLedgerRecord } from "../domain/story.js";
import { STORY_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION, STORY_RUNTIME_KEY } from "../domain/story.js";
import type { LinearMessageLedgerDao } from "../infra/linear-message-ledger.dao.js";
import type { StoryAgentRuntimeSnapshotRepository } from "./persistence/story-agent-runtime-snapshot.repository.js";
import { createStoryAgentSystemPrompt } from "../task-agent/system-prompt.js";
import { CreateStoryTool, CREATE_STORY_TOOL_NAME } from "../task-agent/tools/create-story.tool.js";
import {
  FinishStoryBatchTool,
  FINISH_STORY_BATCH_TOOL_NAME,
} from "../task-agent/tools/finish-story-batch.tool.js";
import {
  RewriteStoryTool,
  REWRITE_STORY_TOOL_NAME,
} from "../task-agent/tools/rewrite-story.tool.js";
import { NOOP_METRIC_SERVICE, recordToolCallMetric } from "../../../runtime/tool-call-metric.js";

const DEFAULT_DASHBOARD_CONTEXT_LIMIT = 40;
const DEFAULT_DASHBOARD_PREVIEW_LENGTH = 160;
const logger = new AppLogger({ source: "agent.story-runtime" });

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

type ContextSummaryLike = Pick<ContextSummaryOperation, "execute">;

export type StoryAgentLoopState =
  | "starting"
  | "idle"
  | "consuming_events"
  | "calling_llm"
  | "executing_tool"
  | "crashed";

export type StoryAgentRuntimeErrorSummary = {
  name: string;
  message: string;
  updatedAt: Date;
};

export type StoryAgentToolCallSummary = {
  name: string;
  argumentsPreview: string;
  updatedAt: Date;
};

export type StoryAgentLlmCallSummary = {
  provider: string;
  model: string;
  assistantContentPreview: string;
  toolCallNames: string[];
  totalTokens: number | null;
  updatedAt: Date;
};

export type StoryAgentRuntimeDashboardSnapshot = {
  initialized: boolean;
  loopState: StoryAgentLoopState;
  lastError: StoryAgentRuntimeErrorSummary | null;
  lastActivityAt: Date | null;
  lastRoundCompletedAt: Date | null;
  lastCompactionAt: Date | null;
  contextCompactionTotalTokenThreshold: number;
  contextSummary: AgentContextDashboardSummary;
  lastToolCall: StoryAgentToolCallSummary | null;
  lastToolResultPreview: string | null;
  lastLlmCall: StoryAgentLlmCallSummary | null;
  story: {
    lastProcessedMessageSeq: number;
    pendingMessageCount: number;
    pendingBatch: {
      firstSeq: number;
      lastSeq: number;
    } | null;
    batchSize: number;
    idleFlushMs: number;
  };
};

type StoryLoopAgentDeps = {
  llmClient: LlmClient;
  linearMessageLedgerDao: LinearMessageLedgerDao;
  snapshotRepository: StoryAgentRuntimeSnapshotRepository;
  storyService: StoryService;
  contextSummaryOperation: ContextSummaryLike;
  summaryTools: Tool[];
  contextCompactionTotalTokenThreshold: number;
  batchSize: number;
  idleFlushMs: number;
  metricService?: MetricService;
  llmRetryBackoffMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  runtimeKey?: string;
  sourceRuntimeKey: string;
  context?: AgentContext;
  eventQueue: Queue<StoryAgentEvent>;
};

type StoryPendingBatch = {
  firstSeq: number;
  lastSeq: number;
  roundMessages: LlmMessage[];
};

class StoryAgentHost {
  private readonly context: AgentContext;
  private readonly linearMessageLedgerDao: LinearMessageLedgerDao;
  private readonly snapshotRepository: StoryAgentRuntimeSnapshotRepository;
  private readonly contextSummaryOperation: ContextSummaryLike;
  private readonly summaryTools: Tool[];
  private readonly contextCompactionTotalTokenThreshold: number;
  private readonly batchSize: number;
  private readonly idleFlushMs: number;
  private readonly metricService: MetricService;
  private readonly llmRetryBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly runtimeKey: string;
  private readonly sourceRuntimeKey: string;
  private initialized = false;
  private loopState: StoryAgentLoopState = "starting";
  private lastProcessedMessageSeq = 0;
  private pendingBatch: StoryPendingBatch | null = null;
  private lastPersistedSnapshotFingerprint: string | null = null;
  private lastActivityAt: Date | null = null;
  private lastRoundCompletedAt: Date | null = null;
  private lastCompactionAt: Date | null = null;
  private lastToolCall: StoryAgentToolCallSummary | null = null;
  private lastToolResultPreview: string | null = null;
  private lastLlmCall: StoryAgentLlmCallSummary | null = null;
  private lastRecoverableError: {
    name: string;
    message: string;
    updatedAt: Date;
  } | null = null;

  public constructor({
    linearMessageLedgerDao,
    snapshotRepository,
    contextSummaryOperation,
    summaryTools,
    contextCompactionTotalTokenThreshold,
    batchSize,
    idleFlushMs,
    metricService,
    llmRetryBackoffMs,
    now,
    sleep,
    runtimeKey,
    sourceRuntimeKey,
    context,
  }: Omit<StoryLoopAgentDeps, "llmClient" | "storyService" | "eventQueue">) {
    this.linearMessageLedgerDao = linearMessageLedgerDao;
    this.snapshotRepository = snapshotRepository;
    this.contextSummaryOperation = contextSummaryOperation;
    this.summaryTools = summaryTools;
    this.contextCompactionTotalTokenThreshold = contextCompactionTotalTokenThreshold;
    this.batchSize = batchSize;
    this.idleFlushMs = idleFlushMs;
    this.metricService = metricService ?? NOOP_METRIC_SERVICE;
    this.llmRetryBackoffMs = llmRetryBackoffMs ?? DEFAULT_LLM_RETRY_BACKOFF_MS;
    this.now = now ?? (() => new Date());
    this.sleep = sleep ?? createSleep;
    this.runtimeKey = runtimeKey ?? STORY_RUNTIME_KEY;
    this.sourceRuntimeKey = sourceRuntimeKey;
    this.context =
      context ??
      new DefaultAgentContext({
        systemPromptFactory: createStoryAgentSystemPrompt,
      });
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.transitionTo("starting");

    try {
      const snapshot = await this.snapshotRepository.load(this.runtimeKey);
      if (snapshot) {
        await this.context.restorePersistedSnapshot(snapshot.contextSnapshot);
        this.lastProcessedMessageSeq = snapshot.lastProcessedMessageSeq;
        this.lastPersistedSnapshotFingerprint = createSnapshotFingerprint(snapshot);
      }

      this.initialized = true;
      this.touchActivity();
      this.transitionTo("idle");
    } catch (error) {
      this.recordCrash(error);
      throw error;
    }
  }

  public async preparePendingBatchIfNeeded(): Promise<{ shouldTriggerRound: boolean }> {
    if (this.pendingBatch) {
      return {
        shouldTriggerRound: true,
      };
    }

    while (true) {
      const pendingCount = await this.linearMessageLedgerDao.countAfterSeq({
        runtimeKey: this.sourceRuntimeKey,
        afterSeq: this.lastProcessedMessageSeq,
      });
      if (pendingCount === 0) {
        return {
          shouldTriggerRound: false,
        };
      }

      const latest = await this.linearMessageLedgerDao.findLatest({
        runtimeKey: this.sourceRuntimeKey,
      });
      const shouldFlushIdle =
        latest !== null && this.now().getTime() - latest.createdAt.getTime() >= this.idleFlushMs;
      if (pendingCount < this.batchSize && !shouldFlushIdle) {
        return {
          shouldTriggerRound: false,
        };
      }

      const batchMessages = await this.linearMessageLedgerDao.listAfterSeq({
        runtimeKey: this.sourceRuntimeKey,
        afterSeq: this.lastProcessedMessageSeq,
        limit: this.batchSize,
      });
      if (batchMessages.length === 0) {
        return {
          shouldTriggerRound: false,
        };
      }

      const pendingBatch = await this.createPendingBatch(batchMessages);
      if (!pendingBatch) {
        this.lastProcessedMessageSeq =
          batchMessages[batchMessages.length - 1]?.seq ?? this.lastProcessedMessageSeq;
        await this.persistSnapshotIfChanged();
        continue;
      }

      this.pendingBatch = pendingBatch;
      return {
        shouldTriggerRound: true,
      };
    }
  }

  public hasPendingBatch(): boolean {
    return this.pendingBatch !== null;
  }

  public getBatchSize(): number {
    return this.batchSize;
  }

  public async resetPersistedState(): Promise<void> {
    await this.context.reset();
    this.lastProcessedMessageSeq = 0;
    this.pendingBatch = null;
    this.lastPersistedSnapshotFingerprint = null;
    await this.snapshotRepository.delete(this.runtimeKey);
  }

  public async createRoundInput(
    tools: ToolExecutor<LlmMessage>,
  ): Promise<ReActKernelRunRoundInput<LlmMessage, "storyAgent"> | null> {
    if (!this.pendingBatch) {
      return null;
    }

    const snapshot = await this.context.getSnapshot();
    this.transitionTo("calling_llm");
    return {
      state: {
        systemPrompt: snapshot.systemPrompt,
        messages: [...snapshot.messages, ...this.pendingBatch.roundMessages],
      },
      tools,
      usage: "storyAgent",
    };
  }

  public async commitRoundResult(
    result: ReActRoundResult<LlmMessage, StoryCompletion, unknown>,
  ): Promise<void> {
    if (!this.pendingBatch) {
      return;
    }

    this.pendingBatch.roundMessages.push(result.assistantMessage, ...result.appendedMessages);
    // Under the new model the kernel runs all tool calls unconditionally, so
    // "batch finished" is determined purely by whether the LLM invoked the
    // finish_story_batch tool this round. Any round that includes that tool
    // is considered terminal for the current batch.
    const batchFinished = result.toolExecutions.some(
      execution => execution.toolCall.name === FINISH_STORY_BATCH_TOOL_NAME,
    );
    if (!batchFinished) {
      return;
    }

    const completedBatch = this.pendingBatch;
    await this.context.appendMessages(completedBatch.roundMessages);
    this.lastProcessedMessageSeq = completedBatch.lastSeq;
    this.pendingBatch = null;
    this.lastRoundCompletedAt = this.now();
    this.touchActivity();
    this.transitionTo("idle");
  }

  public async compactContextIfNeeded(totalTokens: number | null | undefined): Promise<boolean> {
    if (typeof totalTokens !== "number") {
      try {
        logger.warn("Skipping story context summary because totalTokens is missing", {
          event: "agent.story_runtime.context_summary_skipped_missing_total_tokens",
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

      let summary: string | null;
      try {
        summary = await this.contextSummaryOperation.execute({
          systemPrompt: snapshot.systemPrompt,
          messages: compactionPlan.messagesToSummarize,
          tools: this.summaryTools,
        });
      } catch (error) {
        if (!isRetryableLlmFailure(error)) {
          throw error;
        }

        this.recordRecoverableError(error);
        logger.warn("Story context summary failed; scheduling retry", {
          event: "agent.story_runtime.context_summary_retry_scheduled",
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

  public async persistSnapshotIfChanged(): Promise<void> {
    const snapshot = {
      runtimeKey: this.runtimeKey,
      schemaVersion: STORY_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
      contextSnapshot: await this.context.exportPersistedSnapshot(),
      lastProcessedMessageSeq: this.lastProcessedMessageSeq,
    };
    const fingerprint = createSnapshotFingerprint(snapshot);
    if (fingerprint === this.lastPersistedSnapshotFingerprint) {
      return;
    }

    await this.snapshotRepository.save(snapshot);
    this.lastPersistedSnapshotFingerprint = fingerprint;
  }

  public async getContextSnapshot(): Promise<AgentContextSnapshot> {
    return await this.context.getSnapshot();
  }

  public async getDashboardSnapshot(): Promise<StoryAgentRuntimeDashboardSnapshot> {
    const pendingMessageCount = await this.linearMessageLedgerDao.countAfterSeq({
      runtimeKey: this.sourceRuntimeKey,
      afterSeq: this.lastProcessedMessageSeq,
    });

    return {
      initialized: this.initialized,
      loopState: this.loopState,
      lastError: cloneErrorSummary(this.lastRecoverableError),
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
      story: {
        lastProcessedMessageSeq: this.lastProcessedMessageSeq,
        pendingMessageCount,
        pendingBatch: this.getPendingBatchSeqRange(),
        batchSize: this.batchSize,
        idleFlushMs: this.idleFlushMs,
      },
    };
  }

  public getPendingBatchSeqRange(): {
    firstSeq: number;
    lastSeq: number;
  } | null {
    if (!this.pendingBatch) {
      return null;
    }

    return {
      firstSeq: this.pendingBatch.firstSeq,
      lastSeq: this.pendingBatch.lastSeq,
    };
  }

  public recordRecoverableError(error: unknown): void {
    this.lastRecoverableError = {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      updatedAt: this.now(),
    };
    this.touchActivity();
  }

  public clearRecoverableError(): void {
    this.lastRecoverableError = null;
  }

  public recordLlmCall(completion: StoryCompletion): void {
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
      runtime: "storyAgent",
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

  public recordCrash(error: unknown): void {
    this.loopState = "crashed";
    this.lastRecoverableError = {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      updatedAt: this.now(),
    };
    this.touchActivity();
  }

  public transitionTo(loopState: StoryAgentLoopState): void {
    this.loopState = loopState;
  }

  private touchActivity(): void {
    this.lastActivityAt = this.now();
  }

  private async createPendingBatch(
    batchMessages: LinearMessageLedgerRecord[],
  ): Promise<StoryPendingBatch | null> {
    const firstSeq = batchMessages[0]?.seq ?? 0;
    const lastSeq = batchMessages[batchMessages.length - 1]?.seq ?? 0;
    const renderedBatchMessages = batchMessages.map(message => message.message);
    return await this.createPendingBatchFromMessages({
      firstSeq,
      lastSeq,
      renderedBatchMessages,
    });
  }

  private async createPendingBatchFromMessages(input: {
    firstSeq: number;
    lastSeq: number;
    renderedBatchMessages: LlmMessage[];
  }): Promise<StoryPendingBatch | null> {
    const { firstSeq, lastSeq, renderedBatchMessages } = input;
    if (renderedBatchMessages.length === 0) {
      return null;
    }

    return {
      firstSeq,
      lastSeq,
      roundMessages: [
        createUserMessage(renderStoryBatchMessage({ firstSeq, lastSeq, renderedBatchMessages })),
      ],
    };
  }
}

export class StoryLoopAgent extends BaseLoopAgent<LlmMessage, "storyAgent", StoryCompletion> {
  private readonly host: StoryAgentHost;
  private readonly tools: ToolExecutor<LlmMessage>;
  private readonly eventQueue: Queue<StoryAgentEvent>;

  public constructor({
    llmClient,
    storyService,
    sleep,
    llmRetryBackoffMs,
    eventQueue,
    ...rest
  }: StoryLoopAgentDeps) {
    const resolvedSleep = sleep ?? createSleep;
    const resolvedRetryBackoffMs = llmRetryBackoffMs ?? DEFAULT_LLM_RETRY_BACKOFF_MS;
    const host = new StoryAgentHost({
      ...rest,
      sleep: resolvedSleep,
      llmRetryBackoffMs: resolvedRetryBackoffMs,
    });
    const toolDefinitions = new ToolCatalog([
      new CreateStoryTool({
        storyService,
        sourceMessageSeqStart: 0,
        sourceMessageSeqEnd: 0,
      }),
      new RewriteStoryTool({
        storyService,
        sourceMessageSeqStart: 0,
        sourceMessageSeqEnd: 0,
      }),
      new FinishStoryBatchTool(),
    ])
      .pick([CREATE_STORY_TOOL_NAME, REWRITE_STORY_TOOL_NAME, FINISH_STORY_BATCH_TOOL_NAME])
      .definitions();
    const kernel = new ReActKernel<LlmMessage, "storyAgent", StoryCompletion>({
      model: llmClient,
      extensions: [
        new StoryLlmTelemetryExtension({
          host,
        }),
        new LoopLlmRetryExtension({
          backoffPolicy: new FixedRetryBackoffPolicy(resolvedRetryBackoffMs),
          sleep: resolvedSleep,
          onRecoverableError: error => {
            host.recordRecoverableError(error);
            host.transitionTo("idle");
          },
          onBeforeRetry: ({ error, delayMs, attempt }) => {
            logger.warn("Story agent LLM call failed; scheduling retry", {
              event: "agent.story_runtime.llm_retry_scheduled",
              retryBackoffMs: delayMs,
              attempt,
              errorName: error instanceof Error ? error.name : "Error",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          },
          onSuccessfulModelCall: () => {
            host.clearRecoverableError();
          },
        }),
        new StoryToolExecutionStateExtension({
          host,
        }),
        new StoryToolTelemetryExtension({
          host,
        }),
      ],
    });

    super({
      kernel,
      extensions: [
        new StoryContextCompactionExtension({
          host,
        }),
        new StorySnapshotPersistenceExtension({
          host,
        }),
      ],
    });

    this.host = host;
    this.eventQueue = eventQueue;
    this.tools = new StoryBatchToolExecutor({
      host,
      storyService,
      toolDefinitions,
    });
  }

  public async run(): Promise<void> {
    await this.start();
  }

  public async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  public async getContextSnapshot(): Promise<AgentContextSnapshot> {
    return await this.host.getContextSnapshot();
  }

  public async getDashboardSnapshot(): Promise<StoryAgentRuntimeDashboardSnapshot> {
    return await this.host.getDashboardSnapshot();
  }

  public async resetPersistedState(): Promise<void> {
    await this.ensureInitialized();
    await this.host.resetPersistedState();
  }

  protected override async initializeHostIfNeeded(): Promise<void> {
    await this.host.initialize();
  }

  protected override createLoopExtensionContext(): void {
    return undefined;
  }

  protected override onStopRequested(): void {
    // Unblock any blocking tool awaiting the story event queue so the
    // current runOnce iteration can finish and the loop can exit.
    this.eventQueue.enqueue({ type: "wake" });
  }

  protected override async runOnce(): Promise<void> {
    // Drain any wake / ledger_appended events that accumulated in the queue.
    // The event payloads themselves are not consumed into the context;
    // they are pure signals to re-check the ledger state.
    while (this.eventQueue.dequeue() !== null) {
      // no-op: we care about the fact that events arrived, not their data
    }

    // If there's a batch ready (or one becomes ready after checking the
    // ledger), run a round. Otherwise, block on the event queue until the
    // ledger writer pushes another event.
    const prep = await this.host.preparePendingBatchIfNeeded();
    if (prep.shouldTriggerRound) {
      await this.runReactRound();
      return;
    }

    this.host.transitionTo("idle");
    await this.eventQueue.waitNonEmpty();
  }

  protected override async buildRoundInput(): Promise<ReActKernelRunRoundInput<
    LlmMessage,
    "storyAgent"
  > | null> {
    return await this.host.createRoundInput(this.tools);
  }

  protected override async commitRoundResult(
    result: ReActRoundResult<LlmMessage, StoryCompletion>,
  ): Promise<void> {
    await this.host.commitRoundResult(result);
  }

  protected override async onUnhandledError(error: unknown): Promise<void> {
    this.host.recordCrash(error);
    const pendingBatch = this.host.getPendingBatchSeqRange();
    logger.errorWithCause("Story agent loop crashed", error, {
      event: "agent.story_runtime.crashed",
      batchStartSeq: pendingBatch?.firstSeq ?? null,
      batchEndSeq: pendingBatch?.lastSeq ?? null,
    });
  }
}

class StoryLlmTelemetryExtension implements ReActKernelExtension<
  LlmMessage,
  "storyAgent",
  StoryCompletion
> {
  private readonly host: StoryAgentHost;

  public constructor({ host }: { host: StoryAgentHost }) {
    this.host = host;
  }

  public onAfterModel(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "storyAgent">;
    completion: StoryCompletion;
  }): void {
    void input.request;
    this.host.recordLlmCall(input.completion);
  }
}

class StoryToolExecutionStateExtension implements ReActKernelExtension<
  LlmMessage,
  "storyAgent",
  StoryCompletion
> {
  private readonly host: StoryAgentHost;

  public constructor({ host }: { host: StoryAgentHost }) {
    this.host = host;
  }

  public onBeforeToolExecution(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "storyAgent">;
    completion: StoryCompletion;
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

class StoryToolTelemetryExtension implements ReActKernelExtension<
  LlmMessage,
  "storyAgent",
  StoryCompletion
> {
  private readonly host: StoryAgentHost;

  public constructor({ host }: { host: StoryAgentHost }) {
    this.host = host;
  }

  public async onAfterToolExecution(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "storyAgent">;
    completion: StoryCompletion;
    toolCall: {
      name: string;
      arguments: Record<string, unknown>;
    };
    result: ToolSetExecutionResult;
  }): Promise<void> {
    void input.request;
    void input.completion;
    this.host.recordToolCall({
      toolName: input.toolCall.name,
      argumentsValue: input.toolCall.arguments,
      resultContent: input.result.content,
    });
  }
}

class StoryContextCompactionExtension implements LoopAgentExtension<
  void,
  LlmMessage,
  "storyAgent",
  StoryCompletion
> {
  private readonly host: StoryAgentHost;

  public constructor({ host }: { host: StoryAgentHost }) {
    this.host = host;
  }

  public async onAfterCommit(input: {
    result: ReActRoundResult<LlmMessage, StoryCompletion>;
  }): Promise<void> {
    await this.host.compactContextIfNeeded(input.result.completion.usage?.totalTokens);
  }
}

class StorySnapshotPersistenceExtension implements LoopAgentExtension<
  void,
  LlmMessage,
  "storyAgent",
  StoryCompletion
> {
  private readonly host: StoryAgentHost;

  public constructor({ host }: { host: StoryAgentHost }) {
    this.host = host;
  }

  public async onInitialize(): Promise<void> {
    await this.host.persistSnapshotIfChanged();
  }

  public async onAfterCommit(): Promise<void> {
    await this.host.persistSnapshotIfChanged();
  }
}

class StoryBatchToolExecutor implements ToolExecutor<LlmMessage> {
  private readonly host: StoryAgentHost;
  private readonly toolDefinitions: ToolDefinition[];
  private readonly storyService: StoryService;

  public constructor({
    host,
    toolDefinitions,
    storyService,
  }: {
    host: StoryAgentHost;
    toolDefinitions: ToolDefinition[];
    storyService: StoryService;
  }) {
    this.host = host;
    this.toolDefinitions = toolDefinitions;
    this.storyService = storyService;
  }

  public definitions(): ToolDefinition[] {
    return this.toolDefinitions;
  }

  public getKind(name: string): "business" | "control" | null {
    switch (name) {
      case CREATE_STORY_TOOL_NAME:
      case REWRITE_STORY_TOOL_NAME:
        return "business";
      case FINISH_STORY_BATCH_TOOL_NAME:
        return "control";
      default:
        return null;
    }
  }

  public async execute(
    name: string,
    argumentsValue: Record<string, unknown>,
    context: ToolContext<LlmMessage>,
  ): Promise<ToolSetExecutionResult> {
    const pendingBatch = this.host.getPendingBatchSeqRange();
    const sourceMessageSeqStart = pendingBatch?.firstSeq ?? 0;
    const sourceMessageSeqEnd = pendingBatch?.lastSeq ?? 0;
    const toolSet = new ToolCatalog([
      new CreateStoryTool({
        storyService: this.storyService,
        sourceMessageSeqStart,
        sourceMessageSeqEnd,
      }),
      new RewriteStoryTool({
        storyService: this.storyService,
        sourceMessageSeqStart,
        sourceMessageSeqEnd,
      }),
      new FinishStoryBatchTool(),
    ]).pick([CREATE_STORY_TOOL_NAME, REWRITE_STORY_TOOL_NAME, FINISH_STORY_BATCH_TOOL_NAME]);

    return await toolSet.execute(name, argumentsValue, context);
  }
}

function renderStoryBatchMessage(input: {
  firstSeq: number;
  lastSeq: number;
  renderedBatchMessages: LlmMessage[];
}): string {
  const batchBody = input.renderedBatchMessages
    .map((message, index) => {
      const seq = input.firstSeq + index;
      return [`[${seq}] ${message.role}`, renderLlmMessagePlainText(message)].join("\n");
    })
    .join("\n\n");

  return [`<ledger_batch>`, batchBody, `</ledger_batch>`].join("\n");
}

function createSnapshotFingerprint(snapshot: {
  runtimeKey: string;
  schemaVersion: number;
  contextSnapshot: Awaited<ReturnType<AgentContext["exportPersistedSnapshot"]>>;
  lastProcessedMessageSeq: number;
}): string {
  return JSON.stringify({
    runtimeKey: snapshot.runtimeKey,
    schemaVersion: snapshot.schemaVersion,
    contextSnapshot: snapshot.contextSnapshot,
    lastProcessedMessageSeq: snapshot.lastProcessedMessageSeq,
  });
}

async function createSleep(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function cloneErrorSummary(
  value: StoryAgentRuntimeErrorSummary | null,
): StoryAgentRuntimeErrorSummary | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    updatedAt: new Date(value.updatedAt),
  };
}

function cloneToolCallSummary(
  value: StoryAgentToolCallSummary | null,
): StoryAgentToolCallSummary | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    updatedAt: new Date(value.updatedAt),
  };
}

function cloneLlmCallSummary(
  value: StoryAgentLlmCallSummary | null,
): StoryAgentLlmCallSummary | null {
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
