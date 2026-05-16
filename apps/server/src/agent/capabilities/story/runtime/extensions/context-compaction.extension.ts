import type { LoopAgentExtension, ReActRoundResult } from "@kagami/agent-runtime";
import type { LlmClient } from "../../../../../llm/client.js";
import type { LlmMessage } from "../../../../../llm/types.js";
import type { StoryContextLifecycle } from "../story-context-lifecycle.js";
import type { StoryRuntimeTelemetry } from "../story-runtime-telemetry.js";

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

/**
 * 每轮 commit 后检查上下文是否超阈值，必要时调用 contextLifecycle 进行压缩；
 * 一旦成功压缩，把 lastCompactionAt 通过 telemetry 记下供 dashboard 观察。
 */
export class StoryContextCompactionExtension implements LoopAgentExtension<
  void,
  LlmMessage,
  "storyAgent",
  StoryCompletion
> {
  private readonly contextLifecycle: StoryContextLifecycle;
  private readonly telemetry: StoryRuntimeTelemetry;

  public constructor({
    contextLifecycle,
    telemetry,
  }: {
    contextLifecycle: StoryContextLifecycle;
    telemetry: StoryRuntimeTelemetry;
  }) {
    this.contextLifecycle = contextLifecycle;
    this.telemetry = telemetry;
  }

  public async onAfterCommit(input: {
    result: ReActRoundResult<LlmMessage, StoryCompletion>;
  }): Promise<void> {
    const compacted = await this.contextLifecycle.compactContextIfNeeded(
      input.result.completion.usage?.totalTokens,
    );
    if (compacted) {
      this.telemetry.recordCompactionCompleted();
    }
  }
}
