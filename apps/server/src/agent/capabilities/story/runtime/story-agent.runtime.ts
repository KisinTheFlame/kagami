import {
  BaseLoopAgent,
  type LoopAgentExtension,
  ReActKernel,
  ToolCatalog,
  type ReActKernelRunRoundInput,
  type ReActRoundResult,
  type ToolContext,
  type ToolDefinition,
  type ToolExecutor,
  type ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type { AgentContext, AgentContextSnapshot } from "../../../runtime/context/agent-context.js";
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
import type { ContextSummaryOperation } from "../../context-summary/operations/context-summary.operation.js";
import {
  DEFAULT_LLM_RETRY_BACKOFF_MS,
  FixedRetryBackoffPolicy,
  isRetryableLlmFailure,
  LoopLlmRetryExtension,
} from "../../../runtime/llm-retry.js";
import { StoryRecallService, type StoryRecallResult } from "../application/story-recall.service.js";
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

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_CANDIDATE_TOP_K = 5;
const PERSISTED_CONTEXT_KEEP_RATIO = 0.5;
const logger = new AppLogger({ source: "agent.story-runtime" });

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

type ContextSummaryLike = Pick<ContextSummaryOperation, "execute">;

type StoryLoopAgentDeps = {
  llmClient: LlmClient;
  linearMessageLedgerDao: LinearMessageLedgerDao;
  snapshotRepository: StoryAgentRuntimeSnapshotRepository;
  storyService: StoryService;
  storyRecallService: StoryRecallService;
  contextSummaryOperation: ContextSummaryLike;
  summaryTools: Tool[];
  contextCompactionTotalTokenThreshold: number;
  batchSize: number;
  idleFlushMs: number;
  candidateTopK?: number;
  pollIntervalMs?: number;
  llmRetryBackoffMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  runtimeKey?: string;
  sourceRuntimeKey: string;
  context?: AgentContext;
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
  private readonly storyRecallService: StoryRecallService;
  private readonly contextSummaryOperation: ContextSummaryLike;
  private readonly summaryTools: Tool[];
  private readonly contextCompactionTotalTokenThreshold: number;
  private readonly batchSize: number;
  private readonly idleFlushMs: number;
  private readonly candidateTopK: number;
  private readonly llmRetryBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly runtimeKey: string;
  private readonly sourceRuntimeKey: string;
  private initialized = false;
  private lastProcessedMessageSeq = 0;
  private pendingBatch: StoryPendingBatch | null = null;
  private lastPersistedSnapshotFingerprint: string | null = null;
  private lastRecoverableError: {
    name: string;
    message: string;
    updatedAt: Date;
  } | null = null;

  public constructor({
    linearMessageLedgerDao,
    snapshotRepository,
    storyRecallService,
    contextSummaryOperation,
    summaryTools,
    contextCompactionTotalTokenThreshold,
    batchSize,
    idleFlushMs,
    candidateTopK,
    llmRetryBackoffMs,
    now,
    sleep,
    runtimeKey,
    sourceRuntimeKey,
    context,
  }: Omit<StoryLoopAgentDeps, "llmClient" | "storyService" | "pollIntervalMs">) {
    this.linearMessageLedgerDao = linearMessageLedgerDao;
    this.snapshotRepository = snapshotRepository;
    this.storyRecallService = storyRecallService;
    this.contextSummaryOperation = contextSummaryOperation;
    this.summaryTools = summaryTools;
    this.contextCompactionTotalTokenThreshold = contextCompactionTotalTokenThreshold;
    this.batchSize = batchSize;
    this.idleFlushMs = idleFlushMs;
    this.candidateTopK = candidateTopK ?? DEFAULT_CANDIDATE_TOP_K;
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

    const snapshot = await this.snapshotRepository.load(this.runtimeKey);
    if (snapshot) {
      await this.context.restorePersistedSnapshot(snapshot.contextSnapshot);
      this.lastProcessedMessageSeq = snapshot.lastProcessedMessageSeq;
      this.lastPersistedSnapshotFingerprint = createSnapshotFingerprint(snapshot);
    }

    this.initialized = true;
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
    const batchFinished =
      result.toolExecutions.some(execution => execution.result.signal === "finish_round") ||
      !result.shouldContinue;
    if (!batchFinished) {
      return;
    }

    const completedBatch = this.pendingBatch;
    await this.context.appendMessages(completedBatch.roundMessages);
    this.lastProcessedMessageSeq = completedBatch.lastSeq;
    this.pendingBatch = null;
  }

  public async compactContextIfNeeded(totalTokens: number | null | undefined): Promise<void> {
    if (typeof totalTokens !== "number") {
      try {
        logger.warn("Skipping story context summary because totalTokens is missing", {
          event: "agent.story_runtime.context_summary_skipped_missing_total_tokens",
        });
      } catch {
        // Ignore logger runtime setup gaps in tests and early boot.
      }
      return;
    }

    while (true) {
      const snapshot = await this.context.getSnapshot();
      const compactionPlan = createContextCompactionPlan({
        messages: snapshot.messages,
        totalTokens,
        totalTokenThreshold: this.contextCompactionTotalTokenThreshold,
      });
      if (!compactionPlan) {
        return;
      }

      let summary: string | null;
      try {
        summary = await this.contextSummaryOperation.execute({
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
        return;
      }

      await this.context.replaceMessages([
        createConversationSummaryMessage(summary),
        ...compactionPlan.messagesToKeep,
      ]);
      return;
    }
  }

  public async persistSnapshotIfChanged(): Promise<void> {
    const persistedContextSnapshot = trimPersistedContextSnapshot(
      await this.context.exportPersistedSnapshot(),
    );
    const snapshot = {
      runtimeKey: this.runtimeKey,
      schemaVersion: STORY_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
      contextSnapshot: persistedContextSnapshot,
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
  }

  public clearRecoverableError(): void {
    this.lastRecoverableError = null;
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

    const batchSearchText = renderedBatchMessages.map(renderLlmMessagePlainText).join("\n\n");
    const candidates = await this.storyRecallService.search({
      query: batchSearchText,
      topK: this.candidateTopK,
    });

    return {
      firstSeq,
      lastSeq,
      roundMessages: [
        createUserMessage(renderStoryCandidateMessage(candidates)),
        createUserMessage(renderStoryBatchMessage({ firstSeq, lastSeq, renderedBatchMessages })),
      ],
    };
  }
}

export class StoryLoopAgent extends BaseLoopAgent<LlmMessage, "storyAgent", StoryCompletion> {
  private readonly host: StoryAgentHost;
  private readonly tools: ToolExecutor<LlmMessage>;
  private readonly pollIntervalMs: number;

  public constructor({
    llmClient,
    storyService,
    sleep,
    pollIntervalMs,
    llmRetryBackoffMs,
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
        new LoopLlmRetryExtension({
          backoffPolicy: new FixedRetryBackoffPolicy(resolvedRetryBackoffMs),
          sleep: resolvedSleep,
          onRecoverableError: error => {
            host.recordRecoverableError(error);
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
      sleep: resolvedSleep,
    });

    this.host = host;
    this.tools = new StoryBatchToolExecutor({
      host,
      storyService,
      toolDefinitions,
    });
    this.pollIntervalMs = pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  public async run(): Promise<void> {
    await this.start();
  }

  public async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  public async runOnce(): Promise<boolean> {
    await this.ensureInitialized();

    let didRunRound = false;
    while (true) {
      const tickSummary = await this.runSingleTick();
      if (!tickSummary.didRunRound) {
        return didRunRound;
      }

      didRunRound = true;
      if (this.host.hasPendingBatch()) {
        continue;
      }

      const nextBatch = await this.host.preparePendingBatchIfNeeded();
      if (!nextBatch.shouldTriggerRound) {
        return true;
      }
    }
  }

  public async getContextSnapshot(): Promise<AgentContextSnapshot> {
    return await this.host.getContextSnapshot();
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

  protected override async beforeTick(): Promise<{ shouldTriggerRound: boolean }> {
    return await this.host.preparePendingBatchIfNeeded();
  }

  protected override async shouldRunRound(): Promise<boolean> {
    return this.host.hasPendingBatch();
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

  protected override async afterTick(input: {
    didRunRound: boolean;
    roundResult: ReActRoundResult<LlmMessage, StoryCompletion> | null;
  }): Promise<number> {
    void input.roundResult;
    return input.didRunRound ? 0 : this.pollIntervalMs;
  }

  protected override async onUnhandledError(error: unknown): Promise<void> {
    const pendingBatch = this.host.getPendingBatchSeqRange();
    logger.errorWithCause("Story agent loop crashed", error, {
      event: "agent.story_runtime.crashed",
      batchStartSeq: pendingBatch?.firstSeq ?? null,
      batchEndSeq: pendingBatch?.lastSeq ?? null,
    });
  }
}

/**
 * @deprecated Use StoryLoopAgent instead.
 */
export class StoryAgentRuntime extends StoryLoopAgent {}

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

function renderStoryCandidateMessage(candidates: StoryRecallResult[]): string {
  if (candidates.length === 0) {
    return [
      `<system_instruction>`,
      `当前没有召回到候选 story。若这一批消息形成稳定叙事，请创建新 story。`,
      `</system_instruction>`,
    ].join("\n");
  }

  return [
    `<system_instruction>`,
    `下面是基于最新消息召回到的候选 story。默认把连续展开视为同一条 story；如果明显在延续旧叙事，请重写对应 story，而不是重复新建。`,
    JSON.stringify(
      candidates.map(candidate => ({
        storyId: candidate.story.id,
        score: candidate.score,
        matchedKinds: candidate.matchedKinds,
        story: candidate.story.payload,
      })),
      null,
      2,
    ),
    `</system_instruction>`,
  ].join("\n");
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

function trimPersistedContextSnapshot(snapshot: { systemPrompt: string; messages: LlmMessage[] }): {
  systemPrompt: string;
  messages: LlmMessage[];
} {
  return {
    systemPrompt: snapshot.systemPrompt,
    messages: trimPersistedMessages(snapshot.messages),
  };
}

function trimPersistedMessages(messages: LlmMessage[]): LlmMessage[] {
  if (messages.length <= 1) {
    return [...messages];
  }

  const keepCount = Math.max(1, Math.ceil(messages.length * PERSISTED_CONTEXT_KEEP_RATIO));
  const preferredStart = Math.max(0, messages.length - keepCount);
  const firstNonToolIndex = findFirstNonToolIndex(messages, preferredStart);
  if (firstNonToolIndex !== -1) {
    return messages.slice(firstNonToolIndex);
  }

  const fallbackStart = findLastNonToolIndex(messages, preferredStart - 1);
  if (fallbackStart !== -1) {
    return messages.slice(fallbackStart);
  }

  return [];
}

function findFirstNonToolIndex(messages: LlmMessage[], start: number): number {
  for (let index = start; index < messages.length; index += 1) {
    if (messages[index]?.role !== "tool") {
      return index;
    }
  }

  return -1;
}

function findLastNonToolIndex(messages: LlmMessage[], start: number): number {
  for (let index = start; index >= 0; index -= 1) {
    if (messages[index]?.role !== "tool") {
      return index;
    }
  }

  return -1;
}
