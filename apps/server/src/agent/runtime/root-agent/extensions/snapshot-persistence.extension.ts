import type { LoopAgentExtension } from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../llm/types.js";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../root-agent-runtime.js";

export class SnapshotPersistenceExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  public async onInitialize(context: RootLoopExtensionContext): Promise<void> {
    await context.host.persistSnapshotIfChanged();
  }

  public async onBeforeRound(context: RootLoopExtensionContext): Promise<void> {
    await context.host.persistSnapshotIfChanged();
  }

  public async onAfterCommit(input: { context: RootLoopExtensionContext }): Promise<void> {
    await input.context.host.persistSnapshotIfChanged();
  }

  public async onAfterReset(context: RootLoopExtensionContext): Promise<void> {
    await context.host.persistSnapshotIfChanged({
      suppressError: false,
    });
  }
}
