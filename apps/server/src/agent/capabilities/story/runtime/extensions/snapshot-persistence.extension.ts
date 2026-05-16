import type { LoopAgentExtension } from "@kagami/agent-runtime";
import type { LlmClient } from "../../../../../llm/client.js";
import type { LlmMessage } from "../../../../../llm/types.js";
import type { StoryBatchPreparer } from "../story-batch-preparer.js";
import type { StoryContextLifecycle } from "../story-context-lifecycle.js";

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

/**
 * 在 LoopAgent 初始化完成以及每轮 commit 之后触发 snapshot 持久化。
 * contextLifecycle 内部用指纹去重，避免无变化时反复写库。
 */
export class StorySnapshotPersistenceExtension implements LoopAgentExtension<
  void,
  LlmMessage,
  "storyAgent",
  StoryCompletion
> {
  private readonly contextLifecycle: StoryContextLifecycle;
  private readonly batchPreparer: StoryBatchPreparer;

  public constructor({
    contextLifecycle,
    batchPreparer,
  }: {
    contextLifecycle: StoryContextLifecycle;
    batchPreparer: StoryBatchPreparer;
  }) {
    this.contextLifecycle = contextLifecycle;
    this.batchPreparer = batchPreparer;
  }

  public async onInitialize(): Promise<void> {
    await this.persist();
  }

  public async onAfterCommit(): Promise<void> {
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.contextLifecycle.persistSnapshotIfChanged({
      lastProcessedMessageSeq: this.batchPreparer.getLastProcessedMessageSeq(),
    });
  }
}
