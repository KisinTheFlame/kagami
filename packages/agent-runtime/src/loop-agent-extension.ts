import type { LlmMessage } from "@kagami/llm";
import type {
  AssistantLikeMessage,
  ReActCommittedRoundResult,
  ReActKernelRunRoundInput,
  ReActRoundResult,
} from "./react-kernel.js";

export interface LoopAgentExtension<
  TContext,
  TUsage extends string,
  TCompletion extends {
    message: Extract<LlmMessage, { role: "assistant" }> & AssistantLikeMessage;
  },
  TExtensionData = unknown,
> {
  onInitialize?(context: TContext): Promise<void> | void;
  /**
   * Called at the top of each runOnce iteration, before the LLM round runs.
   * Typical use: persist snapshot, append wake reminders.
   */
  onBeforeRound?(context: TContext): Promise<void> | void;
  onAfterRound?(input: {
    context: TContext;
    roundInput: ReActKernelRunRoundInput<TUsage>;
    result: ReActRoundResult<TCompletion, TExtensionData>;
  }): Promise<void> | void;
  onAfterCommit?(input: {
    context: TContext;
    // 只在 shouldCommit: true 的轮触发，收 committed 变体（completion 非 null）。
    result: ReActCommittedRoundResult<TCompletion, TExtensionData>;
  }): Promise<void> | void;
  onAfterReset?(context: TContext): Promise<void> | void;
  onContextCompacted?(context: TContext): Promise<void> | void;
  onUnhandledError?(input: { context: TContext; error: unknown }): Promise<void> | void;
}
