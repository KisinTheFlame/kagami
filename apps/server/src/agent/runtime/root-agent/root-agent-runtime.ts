import {
  BaseLoopAgent,
  type EffectInterpreter,
  type LoopAgentExtension,
  ReActKernel,
  type ReActKernelRunRoundInput,
  type ReActRoundResult,
  type ReplaceLeadingMessagesEffect,
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
import { createWakeReminderMessage } from "../context/context-message-factory.js";
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
} from "./session/root-agent-session.js";
import { WAIT_TOOL_NAME } from "./tools/wait.tool.js";
import { ContextCompactionExtension } from "./extensions/context-compaction.extension.js";
import type { RootAgentExtensionHost } from "./extensions/extension-host.js";
import { createRootEffectInterpreter } from "../effect/root-effect-interpreter.js";
import { RootPostToolEffectsExtension } from "./extensions/post-tool-effects.extension.js";
import { SnapshotPersistenceExtension } from "./extensions/snapshot-persistence.extension.js";
import { RootToolFallbackExtension } from "./extensions/tool-fallback.extension.js";
import { WakeReminderExtension } from "./extensions/wake-reminder.extension.js";

type ContextSummaryLike = Pick<ContextSummaryOperation, "execute">;

type RootLoopExtension = LoopAgentExtension<
  RootLoopExtensionContext,
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
  tools?: ToolExecutor;
  agentTools?: ToolExecutor;
  contextSummaryOperation?: ContextSummaryLike;
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

class RootAgentHost implements RootAgentExtensionHost {
  private readonly context: AgentContext;
  private readonly eventQueue: AgentEventQueue;
  private readonly session: RootAgentSessionController;
  private readonly interpreter: EffectInterpreter<never>;
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
  private lastPersistedSnapshotFingerprint: string | null = null;
  private readonly mutationExecutor = new SerialExecutor();

  public constructor({
    context,
    eventQueue,
    session,
    interpreter,
    snapshotRepository,
    runtimeKey,
    contextSummaryOperation,
    summaryTools,
    contextCompactionTotalTokenThreshold,
    metricService,
    llmRetryBackoffMs,
    now,
    sleep,
  }: Omit<RootAgentRuntimeDeps, "llmClient" | "tools" | "agentTools"> & {
    interpreter: EffectInterpreter<never>;
  }) {
    this.context = context;
    this.eventQueue = eventQueue;
    this.session = session;
    // 由外层 RootAgentRuntime 构造时一次性 new，host 和 kernel 共享同一实例
    // （PR #75 PoC 妥协 #2 解决）。
    this.interpreter = interpreter;
    this.snapshotRepository = snapshotRepository;
    this.runtimeKey = runtimeKey ?? ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY;
    this.contextSummaryOperation = contextSummaryOperation;
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

    await this.mutationExecutor.submit(async () => {
      if (this.initialized) {
        return;
      }

      await this.session.initializeContext();
      this.initialized = true;
    });
  }

  public async restorePersistedSnapshot(
    snapshot: PersistedRootAgentRuntimeSnapshot,
  ): Promise<void> {
    await this.mutationExecutor.submit(async () => {
      await this.context.restorePersistedSnapshot(snapshot.contextSnapshot);
      this.session.restorePersistedSnapshot(snapshot.sessionSnapshot);
      await this.session.flushPendingIncomingEffects();
      this.lastWakeReminderAt = cloneDate(snapshot.lastWakeReminderAt);
      this.lastPersistedSnapshotFingerprint = createSnapshotFingerprint(snapshot);
    });
  }

  public async resetContext(): Promise<{ resetAt: Date }> {
    const resetAt = this.now();
    await this.mutationExecutor.submit(async () => {
      await this.deletePersistedSnapshot();
      this.eventQueue.clear();
      await this.context.reset();
      this.session.reset();
      this.resetRuntimeState();
      await this.session.initializeContext();
      this.initialized = true;
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
    });
  }

  public async getRecentContextSummary(): Promise<AgentContextDashboardSummary> {
    return await this.context.getDashboardSummary({
      limit: DEFAULT_DASHBOARD_CONTEXT_LIMIT,
      previewLength: DEFAULT_DASHBOARD_PREVIEW_LENGTH,
    });
  }

  public getSessionState() {
    return this.session.getState();
  }

  public async consumePendingEvents(): Promise<{ shouldTriggerRound: boolean }> {
    return await this.mutationExecutor.submit(async () => {
      while (true) {
        const event = this.eventQueue.dequeue();
        if (!event) {
          break;
        }

        await this.session.consumeIncomingEvent(event);
      }

      const result = await this.session.flushPendingIncomingEffects();
      return {
        shouldTriggerRound: result.shouldTriggerRound,
      };
    });
  }

  public async createRoundInput(tools: ToolExecutor): Promise<ReActKernelRunRoundInput<"agent">> {
    const snapshot = await this.context.getSnapshot();

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
      } as ReActKernelRunRoundInput<"agent">["toolContext"],
      usage: "agent",
    };
  }

  public async flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects> {
    return await this.session.flushPendingPostToolEffects();
  }

  public async commitRoundResult(
    result: ReActRoundResult<RootAgentCompletion, RootAgentToolExecutionData>,
    tools: ToolExecutor,
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
    });
  }

  public async appendWakeReminderIfNeeded(): Promise<void> {
    const now = this.now();
    await this.mutationExecutor.submit(async () => {
      if (isSameWakeReminderBucket(this.lastWakeReminderAt, now)) {
        return;
      }

      await this.context.appendMessages([createWakeReminderMessage(now)]);
      this.lastWakeReminderAt = new Date(now);
      await this.persistSnapshotIfChanged();
    });
  }

  public async getContextSnapshot(): Promise<AgentContextSnapshot> {
    return await this.context.getSnapshot();
  }

  public async appendMessages(messages: LlmMessage[]): Promise<void> {
    await this.mutationExecutor.submit(async () => {
      await this.context.appendMessages(messages);
    });
  }

  public recordToolCall(input: {
    toolName: string;
    argumentsValue: Record<string, unknown>;
  }): void {
    void recordToolCallMetric({
      metricService: this.metricService,
      runtime: "agent",
      toolName: input.toolName,
      argumentsValue: input.argumentsValue,
    });
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
    }
  }

  public async compactContextIfNeeded(totalTokens: number | null | undefined): Promise<boolean> {
    const operation = this.contextSummaryOperation;
    if (!operation) {
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

      const attempt = await this.attemptSummarize(operation, {
        systemPrompt: snapshot.systemPrompt,
        messages: compactionPlan.messagesToSummarize,
      });
      if (attempt.retry) {
        continue;
      }
      if (attempt.effects.length === 0) {
        return false;
      }

      // 阶段 5：compact 通过 Effect 模型收口，不再直接改 context。Operation 自己产
      // replace_leading_messages Effect，host 只把它交给 Interpreter。
      // Interpreter 是 Agent 状态变更的唯一入口（参见 docs/effect-model.md）。
      await this.interpreter.apply(attempt.effects);
      return true;
    }
  }

  /**
   * 全量压缩：把整条消息列表（不保留最近 10%）一次性摘要成单条 summary。
   * 与阈值无关，由人工面板手动触发。和 compactContextIfNeeded 一样走 Effect 模型
   * 的 replace_leading_messages（count = 全部 message 数），是 KV 缓存允许被破坏的
   * "计划性重建"路径之一。
   */
  public async compactEntireContext(): Promise<boolean> {
    const operation = this.contextSummaryOperation;
    if (!operation) {
      return false;
    }

    while (true) {
      const snapshot = await this.context.getSnapshot();
      if (snapshot.messages.length === 0) {
        return false;
      }

      // 全量压缩：摘要整条消息列表，Operation 产的 count = 全部 message 数。
      const attempt = await this.attemptSummarize(operation, {
        systemPrompt: snapshot.systemPrompt,
        messages: snapshot.messages,
      });
      if (attempt.retry) {
        continue;
      }
      if (attempt.effects.length === 0) {
        return false;
      }

      await this.interpreter.apply(attempt.effects);
      return true;
    }
  }

  private async attemptSummarize(
    operation: ContextSummaryLike,
    input: {
      systemPrompt: string;
      messages: LlmMessage[];
    },
  ): Promise<{ retry: true } | { retry: false; effects: readonly ReplaceLeadingMessagesEffect[] }> {
    try {
      const result = await operation.execute({
        systemPrompt: input.systemPrompt,
        messages: input.messages,
        tools: this.summaryTools,
      });
      return { retry: false, effects: result.effects };
    } catch (error) {
      if (!isRetryableLlmFailure(error)) {
        throw error;
      }

      logger.warn("Context summary failed; scheduling retry", {
        event: "agent.root_agent_runtime.context_summary_retry_scheduled",
        retryBackoffMs: this.llmRetryBackoffMs,
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.sleep(this.llmRetryBackoffMs);
      return { retry: true };
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

  private resetRuntimeState(): void {
    this.lastWakeReminderAt = null;
    this.initialized = false;
    this.lastPersistedSnapshotFingerprint = null;
  }
}

export class RootLoopAgent extends BaseLoopAgent<
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext
> {
  private readonly host: RootAgentHost;
  private readonly tools: ToolExecutor;
  private readonly eventQueue: AgentEventQueue;
  private pendingResetPromise: Promise<{ resetAt: Date }> | null = null;
  private pendingCompactionPromise: Promise<{ compacted: boolean; compactedAt: Date }> | null =
    null;

  public constructor({
    llmClient,
    tools,
    agentTools,
    llmRetryBackoffMs,
    sleep,
    eventQueue,
    loopExtensions,
    session,
    context,
    ...rest
  }: RootAgentRuntimeDeps) {
    const resolvedSleep = sleep ?? createSleep;
    const resolvedRetryBackoffMs = llmRetryBackoffMs ?? DEFAULT_LLM_RETRY_BACKOFF_MS;
    const resolvedTools = tools ?? agentTools ?? failMissingTools();
    // 单例 Interpreter：host（compactContextIfNeeded 直接调）和 kernel（每个工具
    // 跑完后内置消费 effects）共享。Interpreter 无状态，但语义上应该同一个。
    const interpreter = createRootEffectInterpreter({ session, context, eventQueue });
    const host = new RootAgentHost({
      ...rest,
      context,
      session,
      eventQueue,
      interpreter,
      llmRetryBackoffMs: resolvedRetryBackoffMs,
      sleep: resolvedSleep,
    });
    const kernel = new ReActKernel<"agent", RootAgentCompletion, RootAgentToolExecutionData>({
      model: llmClient,
      interpreter,
      extensions: [
        new LoopLlmRetryExtension({
          backoffPolicy: new FixedRetryBackoffPolicy(resolvedRetryBackoffMs),
          sleep: resolvedSleep,
          onBeforeRetry: ({ error, delayMs }) => {
            logger.warn("Root agent LLM call failed; scheduling retry", {
              event: "agent.root_agent_runtime.llm_retry_scheduled",
              retryBackoffMs: delayMs,
              errorName: error instanceof Error ? error.name : "Error",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          },
        }),
        new RootToolFallbackExtension(),
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

  /**
   * 手动触发全量上下文压缩。语义对齐 resetContext：
   * 如果当前正卡在 wait 工具里，先推一个 wake 事件解除阻塞；如果当轮 LLM/工具
   * 调用正在进行，则等它收尾（waitForActiveRunOnce）后再压缩，因此对调用方表现为
   * "立即，或在当次调用完成后"。pendingCompactionPromise 让下一轮 runOnce 在
   * 压缩完成前不会用旧上下文起新一轮。
   */
  public async compactEntireContext(): Promise<{ compacted: boolean; compactedAt: Date }> {
    if (this.pendingCompactionPromise) {
      return await this.pendingCompactionPromise;
    }

    const compactionPromise = (async () => {
      this.eventQueue.enqueue({ type: "wake" });
      await this.waitForActiveRunOnce();

      const compacted = await this.host.compactEntireContext();
      if (compacted) {
        await this.notifyContextCompacted();
      }
      return { compacted, compactedAt: new Date() };
    })();

    this.pendingCompactionPromise = compactionPromise;

    try {
      return await compactionPromise;
    } finally {
      if (this.pendingCompactionPromise === compactionPromise) {
        this.pendingCompactionPromise = null;
      }
    }
  }

  public async hydrateStartupEvents(events: Event[]): Promise<void> {
    await this.host.hydrateStartupEvents(events);
  }

  public async getRecentContextSummary(): Promise<AgentContextDashboardSummary> {
    return await this.host.getRecentContextSummary();
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
    await this.awaitPendingMutations();

    // Step 1: drain any events in the queue into the context. This is the
    // moment where wake events get silently consumed (session routes them
    // to a no-op), napcat messages get routed to their state, etc.
    await this.host.consumePendingEvents();
    await this.awaitPendingMutations();

    // Step 2: run one ReAct round. The LLM may call blocking tools like
    // wait / finish_story_batch; those block inside eventQueue.waitNonEmpty
    // until a producer (real event or timer-enqueued wake) resolves them.
    await this.runReactRound();
  }

  protected override async buildRoundInput(): Promise<ReActKernelRunRoundInput<"agent"> | null> {
    return await this.host.createRoundInput(this.tools);
  }

  protected override async commitRoundResult(
    result: ReActRoundResult<RootAgentCompletion, RootAgentToolExecutionData>,
  ): Promise<void> {
    await this.host.commitRoundResult(result, this.tools);
  }

  protected override async onUnhandledError(error: unknown): Promise<void> {
    logger.errorWithCause("Root agent loop crashed", error, {
      event: "agent.root_agent_runtime.crashed",
    });
  }

  private async awaitPendingReset(): Promise<void> {
    const pendingResetPromise = this.pendingResetPromise;
    if (!pendingResetPromise) {
      return;
    }

    await pendingResetPromise.catch(() => undefined);
  }

  /**
   * 在起新一轮 / drain 事件前，等待任何挂起的 reset 或全量压缩收尾，避免新一轮
   * 用旧上下文起跑，与这些"计划性重建"操作竞争。
   */
  private async awaitPendingMutations(): Promise<void> {
    await this.awaitPendingReset();
    const pendingCompactionPromise = this.pendingCompactionPromise;
    if (pendingCompactionPromise) {
      await pendingCompactionPromise.catch(() => undefined);
    }
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
  agentTools: ToolExecutor,
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

function isSameWakeReminderBucket(previous: Date | null, current: Date): boolean {
  if (previous === null) {
    return false;
  }

  return createWakeReminderBucketKey(previous) === createWakeReminderBucketKey(current);
}

function createWakeReminderBucketKey(now: Date): string {
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

  const minuteNumber = Number.parseInt(values.minute, 10);
  const bucketedMinute = minuteNumber < 30 ? "00" : "30";

  return [values.year, values.month, values.day, values.hour, bucketedMinute].join("-");
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
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
