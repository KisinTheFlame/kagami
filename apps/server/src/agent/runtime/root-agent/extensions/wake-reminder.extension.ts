import type { LoopAgentExtension } from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../llm/types.js";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../root-agent-runtime.js";

export class WakeReminderExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  public async onBeforeRound(context: RootLoopExtensionContext): Promise<void> {
    await context.host.appendWakeReminderIfNeeded();
  }
}
