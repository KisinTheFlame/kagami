import type { LoopAgentExtension, ReActRoundResult } from "@kagami/agent-runtime";
import type { LlmClient } from "../../../../../llm/client.js";
import type { StoryContextLifecycle } from "../story-context-lifecycle.js";

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

/**
 * 每轮 commit 后检查上下文是否超阈值，必要时调用 contextLifecycle 进行压缩。
 */
export class StoryContextCompactionExtension implements LoopAgentExtension<
  void,
  "storyAgent",
  StoryCompletion
> {
  private readonly contextLifecycle: StoryContextLifecycle;

  public constructor({ contextLifecycle }: { contextLifecycle: StoryContextLifecycle }) {
    this.contextLifecycle = contextLifecycle;
  }

  public async onAfterCommit(input: { result: ReActRoundResult<StoryCompletion> }): Promise<void> {
    await this.contextLifecycle.compactContextIfNeeded(input.result.completion.usage?.totalTokens);
  }
}
