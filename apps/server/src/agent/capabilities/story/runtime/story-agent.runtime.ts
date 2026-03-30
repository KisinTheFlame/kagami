import {
  BaseLoopAgent,
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
import {
  createConversationSummaryMessage,
  createUserMessage,
} from "../../../runtime/context/context-message-factory.js";
import { renderLlmMessagePlainText } from "../../../runtime/context/context-item.utils.js";
import type { LlmClient } from "../../../../llm/client.js";
import type { LlmMessage, Tool } from "../../../../llm/types.js";
import { AppLogger } from "../../../../logger/logger.js";
import type { ContextSummaryOperation } from "../../context-summary/operations/context-summary.operation.js";
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
  contextCompactionThreshold: number;
  batchSize: number;
  idleFlushMs: number;
  candidateTopK?: number;
  pollIntervalMs?: number;
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
  private readonly contextCompactionThreshold: number;
  private readonly batchSize: number;
  private readonly idleFlushMs: number;
  private readonly candidateTopK: number;
  private readonly now: () => Date;
  private readonly runtimeKey: string;
  private readonly sourceRuntimeKey: string;
  private initialized = false;
  private lastProcessedMessageSeq = 0;
  private pendingBatch: StoryPendingBatch | null = null;
  private lastPersistedSnapshotFingerprint: string | null = null;

  public constructor({
    linearMessageLedgerDao,
    snapshotRepository,
    storyRecallService,
    contextSummaryOperation,
    summaryTools,
    contextCompactionThreshold,
    batchSize,
    idleFlushMs,
    candidateTopK,
    now,
    runtimeKey,
    sourceRuntimeKey,
    context,
  }: Omit<StoryLoopAgentDeps, "llmClient" | "storyService" | "pollIntervalMs" | "sleep">) {
    this.linearMessageLedgerDao = linearMessageLedgerDao;
    this.snapshotRepository = snapshotRepository;
    this.storyRecallService = storyRecallService;
    this.contextSummaryOperation = contextSummaryOperation;
    this.summaryTools = summaryTools;
    this.contextCompactionThreshold = contextCompactionThreshold;
    this.batchSize = batchSize;
    this.idleFlushMs = idleFlushMs;
    this.candidateTopK = candidateTopK ?? DEFAULT_CANDIDATE_TOP_K;
    this.now = now ?? (() => new Date());
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
  ): Promise<ReActKernelRunRoundInput<LlmMessage, "agent"> | null> {
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
      usage: "agent",
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
    this.pendingBatch = null;

    await this.context.appendMessages(completedBatch.roundMessages);
    await this.compactContextIfNeeded();
    this.lastProcessedMessageSeq = completedBatch.lastSeq;
    await this.persistSnapshotIfChanged();
  }

  public async compactContextIfNeeded(): Promise<void> {
    const snapshot = await this.context.getSnapshot();
    if (snapshot.messages.length <= this.contextCompactionThreshold) {
      return;
    }

    const keepCount = Math.min(
      Math.max(1, Math.ceil(snapshot.messages.length * 0.1)),
      this.contextCompactionThreshold - 1,
    );
    const cutIndex = snapshot.messages.length - keepCount;
    const messagesToSummarize = snapshot.messages.slice(0, cutIndex);
    const messagesToKeep = snapshot.messages.slice(cutIndex);
    const summary = await this.contextSummaryOperation.execute({
      messages: messagesToSummarize,
      tools: this.summaryTools,
    });
    if (!summary) {
      return;
    }

    await this.context.replaceMessages([
      createConversationSummaryMessage(summary),
      ...messagesToKeep,
    ]);
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

export class StoryLoopAgent extends BaseLoopAgent<LlmMessage, "agent", StoryCompletion> {
  private readonly host: StoryAgentHost;
  private readonly tools: ToolExecutor<LlmMessage>;
  private readonly pollIntervalMs: number;

  public constructor({
    llmClient,
    storyService,
    sleep,
    pollIntervalMs,
    ...rest
  }: StoryLoopAgentDeps) {
    const host = new StoryAgentHost(rest);
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
    const kernel = new ReActKernel<LlmMessage, "agent", StoryCompletion>({
      model: llmClient,
    });

    super({
      kernel,
      sleep,
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
      await this.beforeTick();
      if (!(await this.shouldRunRound())) {
        return didRunRound;
      }

      const roundInput = await this.buildRoundInput();
      if (!roundInput) {
        return didRunRound;
      }

      const roundResult = await this.executeRound(roundInput);
      if (roundResult.shouldCommit) {
        await this.commitRoundResult(roundResult);
      }
      didRunRound = true;

      if (!(await this.shouldRunRound())) {
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
    await this.host.compactContextIfNeeded();
    await this.host.persistSnapshotIfChanged();
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
    "agent"
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
