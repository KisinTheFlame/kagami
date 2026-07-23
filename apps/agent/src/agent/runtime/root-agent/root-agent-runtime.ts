import {
  BaseLoopAgent,
  type EffectInterpreter,
  type LoopAgentExtension,
  ReActKernel,
  type ReActKernelRunRoundInput,
  type ReActCommittedRoundResult,
  REPLACE_LEADING_MESSAGES_EFFECT_TYPE,
  type ReplaceLeadingMessagesEffect,
  SerialExecutor,
  TaskAgentMaxRoundsExceededError,
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
import type { AgentEventQueue } from "../event/event.queue.js";
import { isRetryableLlmFailure, type LlmClient } from "@kagami/llm-client";
import type { LlmMessage } from "@kagami/llm-client";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { NOOP_METRIC_CLIENT, type MetricClient } from "@kagami/metric-client/client";
import {
  DEFAULT_LLM_RETRY_BACKOFF_MS,
  FixedRetryBackoffPolicy,
  LoopLlmRetryExtension,
} from "../llm-retry.js";
import type { RootAgentRuntimeSnapshotRepository } from "./persistence/root-agent-runtime-snapshot.repository.js";
import {
  ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  ROOT_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
} from "./persistence/root-agent-runtime-snapshot.repository.js";
import type { PersistedRootAgentRuntimeSnapshot } from "./persistence/root-agent-runtime-snapshot.js";
import { recordToolCallMetric } from "../tool-call-metric.js";
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

/**
 * 上下文摘要器的结构类型（SummaryTaskAgent 的 invoke 面）。runtime 只依赖
 * "给 system + 前缀消息、回摘要字符串"这一契约，不 import 具体 capability 实现。
 */
type ContextSummarizerLike = {
  invoke(input: { systemPrompt: string; messages: LlmMessage[] }): Promise<string>;
};

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
  contextSummarizer?: ContextSummarizerLike;
  contextCompactionTotalTokenThreshold?: number;
  contextCompactionImageCountThreshold?: number;
  metricService?: MetricClient;
  llmRetryBackoffMs?: number;
  loopExtensions?: RootLoopExtension[];
  /** 纯文本轮挂起的自唤醒上限；与 wait 工具的 maxWaitMs 同源（waitToolMaxWaitMs）。 */
  idleWakeMaxWaitMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_IDLE_WAKE_MAX_WAIT_MS = 600_000;
/** 摘要超轮失败后，阈值压缩的冷却时长：期间不再每轮重试，防成本放大。 */
const SUMMARY_MAX_ROUNDS_COOLDOWN_MS = 600_000;
const DEFAULT_CONTEXT_COMPACTION_TOTAL_TOKEN_THRESHOLD = 150_000;
/** 图片是按张计费的重上下文成分，与 token 阈值并列的第二触发条件。 */
const DEFAULT_CONTEXT_COMPACTION_IMAGE_COUNT_THRESHOLD = 550;
const DEFAULT_DASHBOARD_CONTEXT_LIMIT = 40;
const DEFAULT_DASHBOARD_PREVIEW_LENGTH = 160;
const logger = new AppLogger({ source: "agent.root-agent-runtime" });

type PendingToolPersistence = {
  toolResult?: {
    toolCallId: string;
    content: string;
  };
  /**
   * 本次工具执行的 `effects` 经 interpreter 翻译出的待追加消息（App 列表 / 文章正文等
   * "屏幕"）。必须落库——否则 glance_hn / ithome 列表这类只走 `append_message` effect 的
   * 内容只会在回合内可见、不进 ledger，下一轮 Agent 就看不到了。
   */
  effectMessages: LlmMessage[];
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

export class RootAgentHost implements RootAgentExtensionHost {
  private readonly context: AgentContext;
  private readonly eventQueue: AgentEventQueue;
  private readonly session: RootAgentSessionController;
  private readonly interpreter: EffectInterpreter<never>;
  private readonly snapshotRepository?: RootAgentRuntimeSnapshotRepository;
  private readonly runtimeKey: string;
  private readonly contextSummarizer?: ContextSummarizerLike;
  private readonly contextCompactionTotalTokenThreshold: number;
  private readonly contextCompactionImageCountThreshold: number;
  private readonly llmRetryBackoffMs: number;
  private readonly metricService: MetricClient;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastWakeReminderAt: Date | null = null;
  private initialized = false;
  /**
   * 已落库快照对应的 context 修订号（null = 尚未落过）。持久化前先比对 `context.getRevision()`：相等就
   * 整段跳过（不 clone、不序列化、不写库）。取代此前每轮对整条上下文做 O(n) JSON.stringify 指纹的做法。
   * lastWakeReminderAt 的每次变更都伴随一条 wake-reminder 消息追加（见 appendWakeReminderIfNeeded），
   * 故修订号变更能覆盖它——不必单独追踪。
   */
  private lastPersistedRevision: number | null = null;
  /** 摘要超轮失败后的阈值压缩冷却截止时刻（epoch ms）；null = 无冷却。 */
  private summaryCooldownUntilMs: number | null = null;
  private readonly mutationExecutor = new SerialExecutor();

  public constructor({
    context,
    eventQueue,
    session,
    interpreter,
    snapshotRepository,
    runtimeKey,
    contextSummarizer,
    contextCompactionTotalTokenThreshold,
    contextCompactionImageCountThreshold,
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
    this.contextSummarizer = contextSummarizer;
    this.contextCompactionTotalTokenThreshold =
      contextCompactionTotalTokenThreshold ?? DEFAULT_CONTEXT_COMPACTION_TOTAL_TOKEN_THRESHOLD;
    this.contextCompactionImageCountThreshold =
      contextCompactionImageCountThreshold ?? DEFAULT_CONTEXT_COMPACTION_IMAGE_COUNT_THRESHOLD;
    this.metricService = metricService ?? NOOP_METRIC_CLIENT;
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
      // 快照刚回灌、还没 flush 待投递效果：此刻的修订号正好对应库里那份快照。先记下作为落库基线；
      // 随后 flushPendingIncomingEffects 若追加消息会把修订号推高，下一次 persist 便会把增量落库。
      this.lastPersistedRevision = this.context.getRevision();
      this.session.markRestored();
      await this.session.flushPendingIncomingEffects();
      this.lastWakeReminderAt = cloneDate(snapshot.lastWakeReminderAt);
    });
  }

  public async resetContext(): Promise<{ resetAt: Date }> {
    const resetAt = this.now();
    await this.mutationExecutor.submit(async () => {
      await this.deletePersistedSnapshot();
      this.eventQueue.clear();
      // 失焦广播：reset 是「计划性重建」五入口里唯一会清事件队列的，若不通知 App 层，
      // 依赖 App 私有焦点态的机制（如 QQ 的 focused）会悬空——此后前台消息继续走实时
      // 路径却永远 drain 不到、center 又没有 draft，静默滞留。放在 clear 之后：onBlur
      // 的退化补推经 center 窗口 flush（setTimeout 后续才 enqueue），不会被本次 clear
      // 误伤。blurCurrentApp 内部吞错，绝不阻断 reset。
      await this.session.blurCurrentApp();
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

  public async getRecentContextSummary(): Promise<AgentContextDashboardSummary> {
    return await this.context.getDashboardSummary({
      limit: DEFAULT_DASHBOARD_CONTEXT_LIMIT,
      previewLength: DEFAULT_DASHBOARD_PREVIEW_LENGTH,
    });
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
        systemPrompt: snapshot.systemPrompt,
        messages: [...snapshot.messages],
        agentContext: this.context,
        rootAgentSession: this.session,
      } as ReActKernelRunRoundInput<"agent">["toolContext"],
      usage: "agent",
      scene: "agent",
    };
  }

  public async flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects> {
    return await this.session.flushPendingPostToolEffects();
  }

  public async commitRoundResult(
    result: ReActCommittedRoundResult<RootAgentCompletion, RootAgentToolExecutionData>,
    tools: ToolExecutor,
  ): Promise<void> {
    const persistentAssistantMessage = toPersistableAssistantMessage(
      result.assistantMessage,
      tools,
    );
    const assistantToPersist =
      persistentAssistantMessage.toolCalls.length > 0 ? persistentAssistantMessage : null;
    const toolPersistences: PendingToolPersistence[] = result.toolExecutions.map(execution => ({
      // 不再按 content 是否为空过滤：被持久化的 assistant tool_use 必须有配对的
      // tool_result（空串也合法），否则上下文不平衡、下一轮 provider 400 且每轮复发。
      ...(shouldPersistToolResultInContext({
        toolName: execution.toolCall.name,
        toolResult: execution.result,
      })
        ? {
            toolResult: {
              toolCallId: execution.toolCall.id,
              content: execution.result.content,
            },
          }
        : {}),
      effectMessages: execution.effectMessages,
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
    // 走 mutationExecutor 串行化：commitRoundResult 的 persistRoundState 在同一执行器里分两次
    // await 追加 assistant turn 与对应 tool_result，中间存在 await 间隙。若在此间隙直接读 items，
    // 会读到「assistant tool_call 无 tool_result」的不平衡视图（provider 多半 400）。串行化保证
    // 只在某个 persist 完整结束后才取快照，拿到 tool_call/result 平衡的消息数组。
    return await this.mutationExecutor.submit(async () => await this.context.getSnapshot());
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

      // tool 结果之后、postToolEffects 之前追加 effect 产出的"屏幕"消息，
      // 与 kernel 回合内顺序（toolMessages → interpretedMessages → extraMessages）一致。
      if (toolPersistence.effectMessages.length > 0) {
        await this.context.appendMessages(toolPersistence.effectMessages);
      }

      if (toolPersistence.postToolEffects.messages.length > 0) {
        await this.context.appendMessages(toolPersistence.postToolEffects.messages);
      }
    }
  }

  public async compactContextIfNeeded(totalTokens: number | null | undefined): Promise<boolean> {
    const summarizer = this.contextSummarizer;
    if (!summarizer) {
      return false;
    }

    // 超轮失败后的冷却闸：压缩在每轮 commit 后触发，若 summarizer 持续不 finalize
    //（toolChoice auto 下模型可能被上下文带偏），没有冷却就会每轮白烧 maxRounds 次
    // LLM 调用（跨模型对抗审查各自独立命中的成本放大点）。冷却期内跳过阈值压缩；
    // 人工触发的 compactEntireContext 不受此限。
    if (
      this.summaryCooldownUntilMs !== null &&
      this.now().getTime() < this.summaryCooldownUntilMs
    ) {
      return false;
    }

    // totalTokens 缺失时不整体跳过：token 阈值判不了，但图片数阈值仍可判（图片数
    // 直接数消息列表即可，不依赖 provider 回报的 usage）。
    if (typeof totalTokens !== "number") {
      try {
        logger.warn("Context summary token trigger unavailable because totalTokens is missing", {
          event: "agent.root_agent_runtime.context_summary_skipped_missing_total_tokens",
        });
      } catch {
        // Ignore logger runtime setup gaps in tests and early boot.
      }
    }

    while (true) {
      const snapshot = await this.context.getSnapshot();
      const compactionPlan = createContextCompactionPlan({
        messages: snapshot.messages,
        totalTokens: typeof totalTokens === "number" ? totalTokens : null,
        totalTokenThreshold: this.contextCompactionTotalTokenThreshold,
        imageCountThreshold: this.contextCompactionImageCountThreshold,
      });
      if (!compactionPlan) {
        return false;
      }

      const attempt = await this.attemptSummarize(summarizer, {
        systemPrompt: snapshot.systemPrompt,
        messages: compactionPlan.messagesToSummarize,
      });
      if (attempt.retry) {
        continue;
      }
      if (attempt.effects.length === 0) {
        this.summaryCooldownUntilMs = this.now().getTime() + SUMMARY_MAX_ROUNDS_COOLDOWN_MS;
        return false;
      }

      this.summaryCooldownUntilMs = null;

      // 阶段 5：compact 通过 Effect 模型收口，不再直接改 context。attemptSummarize
      // 把 task agent 的摘要拼成 replace_leading_messages Effect，host 只把它交给
      // Interpreter。Interpreter 是 Agent 状态变更的唯一入口。
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
    const summarizer = this.contextSummarizer;
    if (!summarizer) {
      return false;
    }

    while (true) {
      const snapshot = await this.context.getSnapshot();
      if (snapshot.messages.length === 0) {
        return false;
      }

      // 全量压缩：摘要整条消息列表，count = 全部 message 数。
      const attempt = await this.attemptSummarize(summarizer, {
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
      // 全量压缩成功 = 上下文已重建，阈值压缩的冷却没有存在意义了。
      this.summaryCooldownUntilMs = null;
      return true;
    }
  }

  private async attemptSummarize(
    summarizer: ContextSummarizerLike,
    input: {
      systemPrompt: string;
      messages: LlmMessage[];
    },
  ): Promise<{ retry: true } | { retry: false; effects: readonly ReplaceLeadingMessagesEffect[] }> {
    try {
      const summary = await summarizer.invoke({
        systemPrompt: input.systemPrompt,
        messages: input.messages,
      });
      return {
        retry: false,
        effects: [
          {
            type: REPLACE_LEADING_MESSAGES_EFFECT_TYPE,
            // 把被摘要的前缀（input.messages 那 N 条）替换成单条 summary。
            count: input.messages.length,
            replacement: [createConversationSummaryMessage(summary)],
          },
        ],
      };
    } catch (error) {
      if (error instanceof TaskAgentMaxRoundsExceededError) {
        // 跑满轮数仍未 finalize：本次不压缩（阈值仍超会在下一轮再触发），不重试。
        logger.warn("Context summary exceeded max rounds; skipping this compaction", {
          event: "agent.root_agent_runtime.context_summary_max_rounds_exceeded",
          maxRounds: error.maxRounds,
        });
        return { retry: false, effects: [] };
      }

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

    // O(1) 变更判定：context 修订号未变 = 自上次落库以来没改过，整段跳过（不 clone、不序列化、不写库）。
    // 取当前修订号作为「即将落库的下界」——即便快照装配期间又发生并发改动，也只会导致下一轮多存一次
    // （安全冗余），绝不会漏存。
    const revision = this.context.getRevision();
    if (revision === this.lastPersistedRevision) {
      return;
    }

    const snapshot = await this.createPersistedSnapshot();
    try {
      await this.snapshotRepository.save(snapshot);
      this.lastPersistedRevision = revision;
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
      lastWakeReminderAt: cloneDate(this.lastWakeReminderAt),
    };
  }

  private async deletePersistedSnapshot(): Promise<void> {
    if (!this.snapshotRepository) {
      this.lastPersistedRevision = null;
      return;
    }

    try {
      await this.snapshotRepository.delete(this.runtimeKey);
      this.lastPersistedRevision = null;
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
    this.lastPersistedRevision = null;
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
  /** 纯文本轮隐式挂起路径要置位状态供采样归 "wait" 桶（显式 wait 工具路径走 interpreter）。 */
  private readonly session: Pick<RootAgentSessionController, "setSuspended">;
  private readonly idleWakeMaxWaitMs: number;
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
    idleWakeMaxWaitMs,
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
    this.session = session;
    this.idleWakeMaxWaitMs = idleWakeMaxWaitMs ?? DEFAULT_IDLE_WAKE_MAX_WAIT_MS;
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

  public async getRecentContextSummary(): Promise<AgentContextDashboardSummary> {
    return await this.host.getRecentContextSummary();
  }

  /**
   * 完整主上下文快照（system + messages）。给需要 fork 主上下文的一次性子任务用
   * （如 todo digest 的「建议待办」发现）。经 mutationExecutor 串行化取快照，避免读到主轮次
   * persist 中途「assistant tool_call 无 tool_result」的不平衡视图（详见 host.getContextSnapshot）。
   */
  public async getContextSnapshot(): Promise<AgentContextSnapshot> {
    return await this.host.getContextSnapshot();
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
    // wait; those block inside eventQueue.waitNonEmpty
    // until a producer (real event or timer-enqueued wake) resolves them.
    const roundResult = await this.runReactRound();

    // toolChoice auto 下模型可以一个工具都不调（纯文本轮：text 用完即弃、上下文
    // 零写入）。此时本轮视为自然结束，挂起到事件队列非空才进下一轮——否则外层
    // while 会立即用几乎相同的上下文再起一轮 LLM 调用空转。
    if (roundResult?.shouldCommit && roundResult.assistantMessage.toolCalls.length === 0) {
      try {
        // 可观测性：纯文本轮意味着模型「看到但选择不行动」（含对通知不回应）。
        // 完整文本在 llm_chat_call 可查，这里只留一条轻量事件供时间序列归因。
        logger.info("Root agent idle round (zero tool calls); suspending until next event", {
          event: "agent.root_agent_runtime.idle_round_suspended",
        });
      } catch {
        // Ignore logger runtime setup gaps in tests and early boot.
      }
      await this.suspendUntilNextEvent();
    }
  }

  /**
   * 纯文本轮后的挂起，语义对齐 wait 工具的 wait_for_event：
   * - stopRequested 先行复查：stop() 注入的那个 wake 可能已被本轮 step-1 的
   *   consumePendingEvents 吃掉，不复查会在空队列上永久阻塞，关停死锁。
   * - 自唤醒 timer 兜底：与 wait 工具同一个 maxWaitMs 上限，保证生活完全安静时
   *   Agent 也会按自己的节奏醒来（空闲时刻的自主行动心跳），不会无限期沉睡。
   *   timer unref，不阻进程退出；无论谁唤醒都清 timer，避免 stale wake。
   */
  private async suspendUntilNextEvent(): Promise<void> {
    if (this.stopRequested) {
      return;
    }

    const timerHandle = setTimeout(() => {
      this.eventQueue.enqueue({ type: "wake" });
    }, this.idleWakeMaxWaitMs);
    if (typeof timerHandle.unref === "function") {
      timerHandle.unref();
    }

    // 纯文本零工具轮的隐式挂起：与 wait 工具同语义，置 suspended 供状态采样归 "wait" 桶。
    // finally 成对清位，保证唤醒后活跃时间不被错记成 wait。
    this.session.setSuspended(true);
    try {
      await this.eventQueue.waitNonEmpty();
    } finally {
      this.session.setSuspended(false);
      clearTimeout(timerHandle);
    }
  }

  protected override async buildRoundInput(): Promise<ReActKernelRunRoundInput<"agent"> | null> {
    return await this.host.createRoundInput(this.tools);
  }

  protected override async commitRoundResult(
    result: ReActCommittedRoundResult<RootAgentCompletion, RootAgentToolExecutionData>,
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

/**
 * assistant turn 的持久化形态：text 是一次性草稿（用完即弃、不进上下文，完整原文
 * 留在 llm_chat_call 审计记录里可查），control 工具调用同样不留痕（wait 除外）。
 * 剥离发生在写入时——已写入的历史只追加不改写，不违反 KV 缓存的只追加原则。
 */
function toPersistableAssistantMessage(
  message: AssistantMessage,
  agentTools: ToolExecutor,
): AssistantMessage {
  return {
    ...message,
    content: "",
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
