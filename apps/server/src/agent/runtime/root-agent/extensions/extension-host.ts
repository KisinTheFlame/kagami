import type { LlmMessage } from "../../../../llm/types.js";
import type { AgentContextSnapshot } from "../../context/agent-context.js";
import type { RootAgentCompletion, RootAgentLoopState } from "../root-agent-runtime.js";
import type { RootAgentPostToolEffects } from "../session/root-agent-session.js";

/**
 * 暴露给 root agent 扩展的稳定契约。RootAgentHost 的内部细节（mutationExecutor、
 * 各类 last* 状态字段、与 session 的耦合等）不在此处出现；扩展只能调用以下方法。
 *
 * 写 message ledger 的方法分两类：
 * - 仅追加到尾部、保留 KV 前缀的：appendMessages / appendWakeReminderIfNeeded
 * - 计划性重建前缀（昂贵）：compactContextIfNeeded
 *   除上下文压缩外，禁止再引入第二种破坏前缀的入口。
 */
export interface RootAgentExtensionHost {
  appendWakeReminderIfNeeded(): Promise<void>;
  compactContextIfNeeded(totalTokens: number | null | undefined): Promise<boolean>;
  persistSnapshotIfChanged(input?: { suppressError?: boolean }): Promise<void>;
  getContextSnapshot(): Promise<AgentContextSnapshot>;
  appendMessages(messages: LlmMessage[]): Promise<void>;
  recordLlmCall(completion: RootAgentCompletion): void;
  recordToolCall(input: {
    toolName: string;
    argumentsValue: Record<string, unknown>;
    resultContent: string;
  }): void;
  recordRecoverableError(error: unknown): void;
  transitionTo(state: RootAgentLoopState): void;
  flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects>;
}
