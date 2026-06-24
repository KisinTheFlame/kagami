import {
  HandlerEffectInterpreter,
  ReplaceLeadingMessagesHandler,
  type EffectInterpreter,
} from "@kagami/agent-runtime";
import type {
  AgentContext,
  AgentContextDashboardSummary,
  AgentContextSnapshot,
} from "../../../runtime/context/agent-context.js";
import { DefaultAgentContext } from "../../../runtime/context/default-agent-context.js";
import { createContextCompactionPlan } from "../../../runtime/context/context-compaction.js";
import type { LlmMessage, Tool } from "../../../../llm/types.js";
import { AppLogger } from "../../../../logger/logger.js";
import { DEFAULT_LLM_RETRY_BACKOFF_MS, isRetryableLlmFailure } from "../../../runtime/llm-retry.js";
import type { ContextSummaryOperation } from "../../context-summary/operations/context-summary.operation.js";
import { STORY_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION, STORY_RUNTIME_KEY } from "../domain/story.js";
import { createStoryAgentSystemPrompt } from "../task-agent/system-prompt.js";
import type { StoryAgentRuntimeSnapshotRepository } from "./persistence/story-agent-runtime-snapshot.repository.js";
import { createSleep } from "./story-runtime.utils.js";

type ContextSummaryLike = Pick<ContextSummaryOperation, "execute">;

const logger = new AppLogger({ source: "agent.story-runtime" });

type StoryContextLifecycleDeps = {
  snapshotRepository: StoryAgentRuntimeSnapshotRepository;
  contextSummaryOperation: ContextSummaryLike;
  summaryTools: Tool[];
  contextCompactionTotalTokenThreshold: number;
  llmRetryBackoffMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  runtimeKey?: string;
  context?: AgentContext;
};

export type StoryContextLifecycleInitResult = {
  lastProcessedMessageSeq: number;
};

/**
 * 围绕 AgentContext 的"生命周期"组件：负责 snapshot 装载/回写、上下文压缩（含 LLM 重试）、resetPersistedState。
 */
export class StoryContextLifecycle {
  private readonly context: AgentContext;
  private readonly snapshotRepository: StoryAgentRuntimeSnapshotRepository;
  private readonly contextSummaryOperation: ContextSummaryLike;
  private readonly summaryTools: Tool[];
  private readonly contextCompactionTotalTokenThreshold: number;
  private readonly llmRetryBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly runtimeKey: string;
  /**
   * compact 走 Effect 模型：Operation 产 replace_leading_messages Effect，这里用只
   * 装了公共 ReplaceLeadingMessagesHandler 的 Interpreter 解释——复用粒度是 handler，
   * Story 只需要 replace 这一个。
   */
  private readonly interpreter: EffectInterpreter<LlmMessage, never>;
  private lastPersistedSnapshotFingerprint: string | null = null;

  public constructor({
    snapshotRepository,
    contextSummaryOperation,
    summaryTools,
    contextCompactionTotalTokenThreshold,
    llmRetryBackoffMs,
    now,
    sleep,
    runtimeKey,
    context,
  }: StoryContextLifecycleDeps) {
    this.snapshotRepository = snapshotRepository;
    this.contextSummaryOperation = contextSummaryOperation;
    this.summaryTools = summaryTools;
    this.contextCompactionTotalTokenThreshold = contextCompactionTotalTokenThreshold;
    this.llmRetryBackoffMs = llmRetryBackoffMs ?? DEFAULT_LLM_RETRY_BACKOFF_MS;
    this.now = now ?? (() => new Date());
    this.sleep = sleep ?? createSleep;
    this.runtimeKey = runtimeKey ?? STORY_RUNTIME_KEY;
    this.context =
      context ??
      new DefaultAgentContext({
        systemPromptFactory: createStoryAgentSystemPrompt,
      });
    this.interpreter = new HandlerEffectInterpreter<LlmMessage, never>([
      new ReplaceLeadingMessagesHandler<LlmMessage>(this.context),
    ]);
  }

  public getContextCompactionTotalTokenThreshold(): number {
    return this.contextCompactionTotalTokenThreshold;
  }

  public async initialize(): Promise<StoryContextLifecycleInitResult> {
    const snapshot = await this.snapshotRepository.load(this.runtimeKey);
    if (!snapshot) {
      return { lastProcessedMessageSeq: 0 };
    }

    await this.context.restorePersistedSnapshot(snapshot.contextSnapshot);
    this.lastPersistedSnapshotFingerprint = createSnapshotFingerprint(snapshot);
    return { lastProcessedMessageSeq: snapshot.lastProcessedMessageSeq };
  }

  public async appendMessages(messages: LlmMessage[]): Promise<void> {
    await this.context.appendMessages(messages);
  }

  public async getSnapshot(): Promise<AgentContextSnapshot> {
    return await this.context.getSnapshot();
  }

  public async getDashboardSummary(input: {
    limit: number;
    previewLength: number;
  }): Promise<AgentContextDashboardSummary> {
    return await this.context.getDashboardSummary(input);
  }

  /**
   * 检查上下文是否需要压缩；若超阈值则用 contextSummaryOperation 生成摘要并替换历史。
   * 返回 true 表示发生了一次成功压缩。
   */
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

      let result: Awaited<ReturnType<ContextSummaryLike["execute"]>>;
      try {
        result = await this.contextSummaryOperation.execute({
          systemPrompt: snapshot.systemPrompt,
          messages: compactionPlan.messagesToSummarize,
          tools: this.summaryTools,
        });
      } catch (error) {
        if (!isRetryableLlmFailure(error)) {
          throw error;
        }

        logger.warn("Story context summary failed; scheduling retry", {
          event: "agent.story_runtime.context_summary_retry_scheduled",
          retryBackoffMs: this.llmRetryBackoffMs,
          errorName: error instanceof Error ? error.name : "Error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        await this.sleep(this.llmRetryBackoffMs);
        continue;
      }

      if (result.effects.length === 0) {
        return false;
      }

      // compact 通过 Effect 模型收口：Operation 产 replace_leading_messages Effect，
      // 这里的 Interpreter（只含公共 ReplaceLeadingMessagesHandler）解释执行。
      await this.interpreter.apply(result.effects);
      return true;
    }
  }

  public async persistSnapshotIfChanged(input: { lastProcessedMessageSeq: number }): Promise<void> {
    const snapshot = {
      runtimeKey: this.runtimeKey,
      schemaVersion: STORY_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
      contextSnapshot: await this.context.exportPersistedSnapshot(),
      lastProcessedMessageSeq: input.lastProcessedMessageSeq,
    };
    const fingerprint = createSnapshotFingerprint(snapshot);
    if (fingerprint === this.lastPersistedSnapshotFingerprint) {
      return;
    }

    await this.snapshotRepository.save(snapshot);
    this.lastPersistedSnapshotFingerprint = fingerprint;
  }

  public async resetPersistedState(): Promise<void> {
    await this.context.reset();
    this.lastPersistedSnapshotFingerprint = null;
    await this.snapshotRepository.delete(this.runtimeKey);
  }
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
