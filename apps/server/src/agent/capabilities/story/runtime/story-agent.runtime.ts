import {
  BaseLoopAgent,
  type Queue,
  ReActKernel,
  type ReActKernelRunRoundInput,
  type ReActRoundResult,
  type ToolExecutor,
} from "@kagami/agent-runtime";
import type { StoryAgentEvent } from "./story-event.js";
import type {
  AgentContext,
  AgentContextDashboardSummary,
  AgentContextSnapshot,
} from "../../../runtime/context/agent-context.js";
import { createUserMessage } from "../../../runtime/context/context-message-factory.js";
import type { LlmClient } from "../../../../llm/client.js";
import type { LlmMessage } from "../../../../llm/types.js";
import { AppLogger } from "../../../../logger/logger.js";
import type { MetricService } from "../../../../metric/application/metric.service.js";
import type { ContextSummaryOperation } from "../../context-summary/operations/context-summary.operation.js";
import {
  DEFAULT_LLM_RETRY_BACKOFF_MS,
  FixedRetryBackoffPolicy,
  LoopLlmRetryExtension,
} from "../../../runtime/llm-retry.js";
import { StoryService } from "../application/story.service.js";
import type { LinearMessageLedgerDao } from "../infra/linear-message-ledger.dao.js";
import { StoryBatchPreparer } from "./story-batch-preparer.js";
import { StoryContextLifecycle } from "./story-context-lifecycle.js";
import { StoryContextCompactionExtension } from "./extensions/context-compaction.extension.js";
import { StorySnapshotPersistenceExtension } from "./extensions/snapshot-persistence.extension.js";
import { StoryTelemetryKernelExtension } from "./extensions/telemetry.kernel-extension.js";
import type { StoryAgentRuntimeSnapshotRepository } from "./persistence/story-agent-runtime-snapshot.repository.js";
import {
  StoryRuntimeTelemetry,
  type StoryAgentLlmCallSummary,
  type StoryAgentLoopState,
  type StoryAgentRuntimeErrorSummary,
  type StoryAgentToolCallSummary,
} from "./story-runtime-telemetry.js";
import type { Tool } from "../../../../llm/types.js";
import {
  DEFAULT_DASHBOARD_CONTEXT_LIMIT,
  DEFAULT_DASHBOARD_PREVIEW_LENGTH,
  createSleep,
  renderStoryBatchMessage,
} from "./story-runtime.utils.js";
import {
  createStoryBatchToolDefinitions,
  StoryBatchToolExecutor,
} from "./tools/story-batch.tool-executor.js";

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

const logger = new AppLogger({ source: "agent.story-runtime" });

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
  contextSummaryOperation: Pick<ContextSummaryOperation, "execute">;
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

/**
 * Story 子 Agent 的运行时入口。本类是一个**薄协调层**，三个职责完全委托给独立组件：
 *
 * - {@link StoryRuntimeTelemetry}：所有面向 Dashboard 的可观测状态。
 * - {@link StoryBatchPreparer}：从 ledger 切批、维护批次游标、判定 batch 完成。
 * - {@link StoryContextLifecycle}：AgentContext snapshot 装载/回写、上下文压缩。
 */
export class StoryLoopAgent extends BaseLoopAgent<LlmMessage, "storyAgent", StoryCompletion> {
  private readonly telemetry: StoryRuntimeTelemetry;
  private readonly batchPreparer: StoryBatchPreparer;
  private readonly contextLifecycle: StoryContextLifecycle;
  private readonly tools: ToolExecutor<LlmMessage>;
  private readonly eventQueue: Queue<StoryAgentEvent>;
  private hostInitialized = false;

  public constructor({
    llmClient,
    linearMessageLedgerDao,
    snapshotRepository,
    storyService,
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
    eventQueue,
  }: StoryLoopAgentDeps) {
    const resolvedSleep = sleep ?? createSleep;
    const resolvedRetryBackoffMs = llmRetryBackoffMs ?? DEFAULT_LLM_RETRY_BACKOFF_MS;

    const telemetry = new StoryRuntimeTelemetry({
      metricService,
      now,
    });
    const batchPreparer = new StoryBatchPreparer({
      linearMessageLedgerDao,
      sourceRuntimeKey,
      batchSize,
      idleFlushMs,
      now,
    });
    const contextLifecycle = new StoryContextLifecycle({
      snapshotRepository,
      contextSummaryOperation,
      summaryTools,
      contextCompactionTotalTokenThreshold,
      telemetry,
      llmRetryBackoffMs: resolvedRetryBackoffMs,
      now,
      sleep: resolvedSleep,
      runtimeKey,
      context,
    });
    const toolDefinitions = createStoryBatchToolDefinitions({ storyService });
    const tools = new StoryBatchToolExecutor({
      storyService,
      toolDefinitions,
      getPendingBatchSeqRange: () => batchPreparer.getPendingBatchSeqRange(),
    });

    const kernel = new ReActKernel<LlmMessage, "storyAgent", StoryCompletion>({
      model: llmClient,
      extensions: [
        new StoryTelemetryKernelExtension({ telemetry }),
        new LoopLlmRetryExtension({
          backoffPolicy: new FixedRetryBackoffPolicy(resolvedRetryBackoffMs),
          sleep: resolvedSleep,
          onRecoverableError: error => {
            telemetry.recordRecoverableError(error);
            telemetry.transitionTo("idle");
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
            telemetry.clearRecoverableError();
          },
        }),
      ],
    });

    super({
      kernel,
      extensions: [
        new StoryContextCompactionExtension({
          contextLifecycle,
          telemetry,
        }),
        new StorySnapshotPersistenceExtension({
          contextLifecycle,
          batchPreparer,
        }),
      ],
    });

    this.telemetry = telemetry;
    this.batchPreparer = batchPreparer;
    this.contextLifecycle = contextLifecycle;
    this.tools = tools;
    this.eventQueue = eventQueue;
  }

  public async run(): Promise<void> {
    await this.start();
  }

  public async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  public async getContextSnapshot(): Promise<AgentContextSnapshot> {
    return await this.contextLifecycle.getSnapshot();
  }

  public async getDashboardSnapshot(): Promise<StoryAgentRuntimeDashboardSnapshot> {
    const pendingMessageCount = await this.batchPreparer.countPendingMessages();
    const telemetryView = this.telemetry.view();
    return {
      initialized: this.hostInitialized,
      loopState: telemetryView.loopState,
      lastError: telemetryView.lastError,
      lastActivityAt: telemetryView.lastActivityAt,
      lastRoundCompletedAt: telemetryView.lastRoundCompletedAt,
      lastCompactionAt: telemetryView.lastCompactionAt,
      contextCompactionTotalTokenThreshold:
        this.contextLifecycle.getContextCompactionTotalTokenThreshold(),
      contextSummary: await this.contextLifecycle.getDashboardSummary({
        limit: DEFAULT_DASHBOARD_CONTEXT_LIMIT,
        previewLength: DEFAULT_DASHBOARD_PREVIEW_LENGTH,
      }),
      lastToolCall: telemetryView.lastToolCall,
      lastToolResultPreview: telemetryView.lastToolResultPreview,
      lastLlmCall: telemetryView.lastLlmCall,
      story: {
        lastProcessedMessageSeq: this.batchPreparer.getLastProcessedMessageSeq(),
        pendingMessageCount,
        pendingBatch: this.batchPreparer.getPendingBatchSeqRange(),
        batchSize: this.batchPreparer.getBatchSize(),
        idleFlushMs: this.batchPreparer.getIdleFlushMs(),
      },
    };
  }

  public async resetPersistedState(): Promise<void> {
    await this.ensureInitialized();
    await this.contextLifecycle.resetPersistedState();
    this.batchPreparer.reset();
  }

  protected override async initializeHostIfNeeded(): Promise<void> {
    if (this.hostInitialized) {
      return;
    }

    this.telemetry.transitionTo("starting");
    try {
      const { lastProcessedMessageSeq } = await this.contextLifecycle.initialize();
      this.batchPreparer.restoreLastProcessedMessageSeq(lastProcessedMessageSeq);
      this.hostInitialized = true;
      this.telemetry.touchActivity();
      this.telemetry.transitionTo("idle");
    } catch (error) {
      this.telemetry.recordCrash(error);
      throw error;
    }
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

    const prep = await this.batchPreparer.preparePendingBatchIfNeeded({
      renderBatch: async batchMessages => {
        const firstSeq = batchMessages[0]?.seq ?? 0;
        const lastSeq = batchMessages[batchMessages.length - 1]?.seq ?? 0;
        const renderedBatchMessages = batchMessages.map(record => record.message);
        return [
          createUserMessage(renderStoryBatchMessage({ firstSeq, lastSeq, renderedBatchMessages })),
        ];
      },
    });
    if (prep.shouldTriggerRound) {
      await this.runReactRound();
      return;
    }

    this.telemetry.transitionTo("idle");
    await this.eventQueue.waitNonEmpty();
  }

  protected override async buildRoundInput(): Promise<ReActKernelRunRoundInput<
    LlmMessage,
    "storyAgent"
  > | null> {
    const pendingBatchMessages = this.batchPreparer.getPendingBatchRoundMessages();
    if (!pendingBatchMessages) {
      return null;
    }

    const snapshot = await this.contextLifecycle.getSnapshot();
    this.telemetry.transitionTo("calling_llm");
    return {
      state: {
        systemPrompt: snapshot.systemPrompt,
        messages: [...snapshot.messages, ...pendingBatchMessages],
      },
      tools: this.tools,
      usage: "storyAgent",
    };
  }

  protected override async commitRoundResult(
    result: ReActRoundResult<LlmMessage, StoryCompletion>,
  ): Promise<void> {
    const outcome = this.batchPreparer.commitRound(result);
    if (outcome.kind === "completed") {
      await this.contextLifecycle.appendMessages(outcome.messagesToAppend);
      this.telemetry.recordRoundCompleted();
    }
  }

  protected override async onUnhandledError(error: unknown): Promise<void> {
    this.telemetry.recordCrash(error);
    const pendingBatch = this.batchPreparer.getPendingBatchSeqRange();
    logger.errorWithCause("Story agent loop crashed", error, {
      event: "agent.story_runtime.crashed",
      batchStartSeq: pendingBatch?.firstSeq ?? null,
      batchEndSeq: pendingBatch?.lastSeq ?? null,
    });
  }
}
