import type { LlmClient } from "../../../../llm/client.js";
import type { LlmMessage } from "../../../../llm/types.js";
import type { LinearMessageLedgerRecord } from "../domain/story.js";
import { FINISH_STORY_BATCH_TOOL_NAME } from "../task-agent/tools/finish-story-batch.tool.js";
import type { LinearMessageLedgerDao } from "../infra/linear-message-ledger.dao.js";
import type { ReActRoundResult } from "@kagami/agent-runtime";

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

type StoryPendingBatch = {
  firstSeq: number;
  lastSeq: number;
  roundMessages: LlmMessage[];
};

export type StoryBatchSeqRange = {
  firstSeq: number;
  lastSeq: number;
};

export type StoryBatchCommitOutcome =
  | { kind: "pending" }
  | { kind: "completed"; messagesToAppend: LlmMessage[]; lastSeq: number };

type StoryBatchPreparerDeps = {
  linearMessageLedgerDao: LinearMessageLedgerDao;
  sourceRuntimeKey: string;
  batchSize: number;
  idleFlushMs: number;
  now?: () => Date;
};

/**
 * 负责把 source runtime 写入 ledger 的连续消息切成可处理的批次：
 * 维护 lastProcessedMessageSeq + 当前 pendingBatch，并把"batch 完成"的判定（finish_story_batch 工具）封装在内部。
 * 不持有 context、不写 telemetry、不感知 LLM；外部只通过 commit 拿到"是否完成 + 应当 append 的消息"。
 */
export class StoryBatchPreparer {
  private readonly linearMessageLedgerDao: LinearMessageLedgerDao;
  private readonly sourceRuntimeKey: string;
  private readonly batchSize: number;
  private readonly idleFlushMs: number;
  private readonly now: () => Date;
  private lastProcessedMessageSeq = 0;
  private pendingBatch: StoryPendingBatch | null = null;

  public constructor({
    linearMessageLedgerDao,
    sourceRuntimeKey,
    batchSize,
    idleFlushMs,
    now,
  }: StoryBatchPreparerDeps) {
    this.linearMessageLedgerDao = linearMessageLedgerDao;
    this.sourceRuntimeKey = sourceRuntimeKey;
    this.batchSize = batchSize;
    this.idleFlushMs = idleFlushMs;
    this.now = now ?? (() => new Date());
  }

  public getBatchSize(): number {
    return this.batchSize;
  }

  public getIdleFlushMs(): number {
    return this.idleFlushMs;
  }

  public getLastProcessedMessageSeq(): number {
    return this.lastProcessedMessageSeq;
  }

  public hasPendingBatch(): boolean {
    return this.pendingBatch !== null;
  }

  public getPendingBatchSeqRange(): StoryBatchSeqRange | null {
    if (!this.pendingBatch) {
      return null;
    }

    return {
      firstSeq: this.pendingBatch.firstSeq,
      lastSeq: this.pendingBatch.lastSeq,
    };
  }

  public getPendingBatchRoundMessages(): readonly LlmMessage[] | null {
    // 返回浅拷贝，避免外部持有内部数组的实时引用后误改。spread 在 buildRoundInput
    // 里也只是一次性消费，clone 的成本可忽略。
    return this.pendingBatch ? [...this.pendingBatch.roundMessages] : null;
  }

  public async countPendingMessages(): Promise<number> {
    return await this.linearMessageLedgerDao.countAfterSeq({
      runtimeKey: this.sourceRuntimeKey,
      afterSeq: this.lastProcessedMessageSeq,
    });
  }

  public restoreLastProcessedMessageSeq(seq: number): void {
    this.lastProcessedMessageSeq = seq;
  }

  public reset(): void {
    this.lastProcessedMessageSeq = 0;
    this.pendingBatch = null;
  }

  public async preparePendingBatchIfNeeded(input: {
    renderBatch: (batchMessages: LinearMessageLedgerRecord[]) => Promise<LlmMessage[]>;
  }): Promise<{ shouldTriggerRound: boolean }> {
    if (this.pendingBatch) {
      return { shouldTriggerRound: true };
    }

    while (true) {
      const pendingCount = await this.linearMessageLedgerDao.countAfterSeq({
        runtimeKey: this.sourceRuntimeKey,
        afterSeq: this.lastProcessedMessageSeq,
      });
      if (pendingCount === 0) {
        return { shouldTriggerRound: false };
      }

      const latest = await this.linearMessageLedgerDao.findLatest({
        runtimeKey: this.sourceRuntimeKey,
      });
      const shouldFlushIdle =
        latest !== null && this.now().getTime() - latest.createdAt.getTime() >= this.idleFlushMs;
      if (pendingCount < this.batchSize && !shouldFlushIdle) {
        return { shouldTriggerRound: false };
      }

      const batchMessages = await this.linearMessageLedgerDao.listAfterSeq({
        runtimeKey: this.sourceRuntimeKey,
        afterSeq: this.lastProcessedMessageSeq,
        limit: this.batchSize,
      });
      if (batchMessages.length === 0) {
        return { shouldTriggerRound: false };
      }

      const renderedRoundMessages = await input.renderBatch(batchMessages);
      if (renderedRoundMessages.length === 0) {
        // 渲染产物为空时跳过这批，推进游标。下一轮循环会再检查 ledger。
        this.lastProcessedMessageSeq =
          batchMessages[batchMessages.length - 1]?.seq ?? this.lastProcessedMessageSeq;
        continue;
      }

      this.pendingBatch = {
        firstSeq: batchMessages[0]?.seq ?? 0,
        lastSeq: batchMessages[batchMessages.length - 1]?.seq ?? 0,
        roundMessages: renderedRoundMessages,
      };
      return { shouldTriggerRound: true };
    }
  }

  /**
   * 处理一轮 ReAct kernel 输出：把最新一轮消息累加进 pendingBatch.roundMessages，
   * 并判定 batch 是否结束。若结束，返回 completed outcome 但**不 mutate** seq / pendingBatch ——
   * 调用方需要在 append 到 context 成功后调用 {@link markCommitted} 才会真正前进游标。
   * 这保留了原始单体 host 的不变量：context 写成功 → 才认这批已消费。
   */
  public commitRound(result: ReActRoundResult<StoryCompletion, unknown>): StoryBatchCommitOutcome {
    if (!this.pendingBatch) {
      return { kind: "pending" };
    }

    this.pendingBatch.roundMessages.push(result.assistantMessage, ...result.appendedMessages);
    const batchFinished = result.toolExecutions.some(
      execution => execution.toolCall.name === FINISH_STORY_BATCH_TOOL_NAME,
    );
    if (!batchFinished) {
      return { kind: "pending" };
    }

    return {
      kind: "completed",
      messagesToAppend: [...this.pendingBatch.roundMessages],
      lastSeq: this.pendingBatch.lastSeq,
    };
  }

  /**
   * 在 LoopAgent 把 commit outcome 写入 context 成功后调用，正式推进游标并释放 pendingBatch。
   * append 抛错时此方法不应被调用，pendingBatch 维持原状以便下一轮重试。
   */
  public markCommitted(lastSeq: number): void {
    if (!this.pendingBatch || this.pendingBatch.lastSeq !== lastSeq) {
      return;
    }
    this.lastProcessedMessageSeq = lastSeq;
    this.pendingBatch = null;
  }
}
