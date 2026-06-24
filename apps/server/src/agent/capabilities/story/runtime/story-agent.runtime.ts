import {
  BaseLoopAgent,
  NoopEffectInterpreter,
  type Queue,
  ReActKernel,
  type ReActKernelRunRoundInput,
  type ReActRoundResult,
  type ToolExecutor,
} from "@kagami/agent-runtime";
import type { StoryAgentEvent } from "./story-event.js";
import { NOOP_METRIC_SERVICE } from "../../../runtime/tool-call-metric.js";
import type { AgentContext, AgentContextSnapshot } from "../../../runtime/context/agent-context.js";
import { createUserMessage } from "../../../runtime/context/context-message-factory.js";
import type { LlmClient } from "../../../../llm/client.js";
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
import { StoryToolCallMetricKernelExtension } from "./extensions/telemetry.kernel-extension.js";
import type { StoryAgentRuntimeSnapshotRepository } from "./persistence/story-agent-runtime-snapshot.repository.js";
import type { Tool } from "../../../../llm/types.js";
import { createSleep, renderStoryBatchMessage } from "./story-runtime.utils.js";
import {
  createStoryBatchToolDefinitions,
  StoryBatchToolExecutor,
} from "./tools/story-batch.tool-executor.js";

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

const logger = new AppLogger({ source: "agent.story-runtime" });

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
 * Story 子 Agent 的运行时入口。本类是一个**薄协调层**，两个职责完全委托给独立组件：
 *
 * - {@link StoryBatchPreparer}：从 ledger 切批、维护批次游标、判定 batch 完成。
 * - {@link StoryContextLifecycle}：AgentContext snapshot 装载/回写、上下文压缩。
 */
export class StoryLoopAgent extends BaseLoopAgent<"storyAgent", StoryCompletion> {
  private readonly batchPreparer: StoryBatchPreparer;
  private readonly contextLifecycle: StoryContextLifecycle;
  private readonly tools: ToolExecutor;
  private readonly eventQueue: Queue<StoryAgentEvent>;

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
    const resolvedMetricService = metricService ?? NOOP_METRIC_SERVICE;

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

    const kernel = new ReActKernel<"storyAgent", StoryCompletion>({
      model: llmClient,
      // Story 工具集不产 Effect——显式 noop interpreter 表达 "这条路径不处理 effects"，
      // 任何意外产生的 effects 会触发 noop 的 throw，便于发现 bug。
      interpreter: new NoopEffectInterpreter(),
      extensions: [
        new StoryToolCallMetricKernelExtension({ metricService: resolvedMetricService }),
        new LoopLlmRetryExtension({
          backoffPolicy: new FixedRetryBackoffPolicy(resolvedRetryBackoffMs),
          sleep: resolvedSleep,
          onBeforeRetry: ({ error, delayMs, attempt }) => {
            logger.warn("Story agent LLM call failed; scheduling retry", {
              event: "agent.story_runtime.llm_retry_scheduled",
              retryBackoffMs: delayMs,
              attempt,
              errorName: error instanceof Error ? error.name : "Error",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          },
        }),
      ],
    });

    super({
      kernel,
      extensions: [
        new StoryContextCompactionExtension({ contextLifecycle }),
        new StorySnapshotPersistenceExtension({
          contextLifecycle,
          batchPreparer,
        }),
      ],
    });

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

  public async resetPersistedState(): Promise<void> {
    await this.ensureInitialized();
    await this.contextLifecycle.resetPersistedState();
    this.batchPreparer.reset();
  }

  protected override async initializeHostIfNeeded(): Promise<void> {
    const { lastProcessedMessageSeq } = await this.contextLifecycle.initialize();
    this.batchPreparer.restoreLastProcessedMessageSeq(lastProcessedMessageSeq);
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

    await this.eventQueue.waitNonEmpty();
  }

  protected override async buildRoundInput(): Promise<ReActKernelRunRoundInput<"storyAgent"> | null> {
    const pendingBatchMessages = this.batchPreparer.getPendingBatchRoundMessages();
    if (!pendingBatchMessages) {
      return null;
    }

    const snapshot = await this.contextLifecycle.getSnapshot();
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
    result: ReActRoundResult<StoryCompletion>,
  ): Promise<void> {
    const outcome = this.batchPreparer.commitRound(result);
    if (outcome.kind === "completed") {
      // 先把消息写入 context，再 markCommitted 推进游标。append 抛错时
      // pendingBatch 维持原状，下轮 runOnce 会重试这一批，避免游标已前进
      // 但消息未落入 context 导致的丢批问题。
      await this.contextLifecycle.appendMessages(outcome.messagesToAppend);
      this.batchPreparer.markCommitted(outcome.lastSeq);
    }
  }

  protected override async onUnhandledError(error: unknown): Promise<void> {
    const pendingBatch = this.batchPreparer.getPendingBatchSeqRange();
    logger.errorWithCause("Story agent loop crashed", error, {
      event: "agent.story_runtime.crashed",
      batchStartSeq: pendingBatch?.firstSeq ?? null,
      batchEndSeq: pendingBatch?.lastSeq ?? null,
    });
  }
}
