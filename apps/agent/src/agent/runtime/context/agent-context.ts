import type { LlmMessage } from "../../../llm/types.js";
import type { Event } from "../event/event.js";
import type { PersistedAgentContextSnapshot } from "../root-agent/persistence/root-agent-runtime-snapshot.js";

export type AssistantMessage = Extract<LlmMessage, { role: "assistant" }>;
export type AgentContextDashboardItem = {
  kind: "llm_message" | "event";
  label: string;
  preview: string;
  truncated: boolean;
};
export type AgentContextDashboardSummary = {
  messageCount: number;
  recentItems: AgentContextDashboardItem[];
  recentItemsTruncated: boolean;
};
export type ContextEventItem = {
  kind: "event";
  event: Event;
};
export type ContextLlmMessageItem = {
  kind: "llm_message";
  message: LlmMessage;
};
export type ContextItem = ContextEventItem | ContextLlmMessageItem;

export type AgentContextSnapshot = {
  systemPrompt: string;
  messages: LlmMessage[];
};

export interface AgentContext {
  getSnapshot(): Promise<AgentContextSnapshot>;
  fork(): Promise<AgentContext>;
  exportPersistedSnapshot(): Promise<PersistedAgentContextSnapshot>;
  restorePersistedSnapshot(snapshot: PersistedAgentContextSnapshot): Promise<void>;
  reset(): Promise<void>;
  appendEvents(events: Event[]): Promise<void>;
  appendMessages(messages: LlmMessage[]): Promise<void>;
  appendAssistantTurn(message: AssistantMessage): Promise<void>;
  appendToolResult(input: { toolCallId: string; content: string }): Promise<void>;
  /**
   * 把最前面的 `count` 条 message（按展平后的 message 计）替换成 `replacement`。
   * 上下文压缩的"计划性重建"用——破坏 KV 缓存前缀，仅压缩路径应调用。
   *
   * `count` 必须落在内部 ContextItem 的边界上（一个 event item 可能渲染成 0 条
   * message，所以 message 下标和 item 下标不一定对齐）。落不上会抛错。
   */
  replaceLeadingMessages(count: number, replacement: LlmMessage[]): Promise<void>;
  getDashboardSummary(input?: {
    limit?: number;
    previewLength?: number;
  }): Promise<AgentContextDashboardSummary>;
}
