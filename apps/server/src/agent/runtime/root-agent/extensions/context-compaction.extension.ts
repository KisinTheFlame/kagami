import type { LoopAgentExtension, ReActRoundResult } from "@kagami/agent-runtime";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../root-agent-runtime.js";

export class ContextCompactionExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  public async onAfterCommit(input: {
    context: RootLoopExtensionContext;
    result: ReActRoundResult<RootAgentCompletion, RootAgentToolExecutionData>;
  }): Promise<void> {
    const compacted = await input.context.host.compactContextIfNeeded(
      input.result.completion.usage?.totalTokens,
    );
    if (compacted) {
      await input.context.notifyContextCompacted();
    }
  }
}
