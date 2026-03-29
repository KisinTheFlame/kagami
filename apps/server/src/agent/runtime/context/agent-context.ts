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
export type ContextGroupMessageEventItem = {
  kind: "event";
  event: Event;
};
export type ContextLlmMessageItem = {
  kind: "llm_message";
  message: LlmMessage;
};
export type ContextItem = ContextGroupMessageEventItem | ContextLlmMessageItem;

export type AgentContextSnapshot = {
  systemPrompt: string;
  messages: LlmMessage[];
};

export interface AgentContext {
  getSnapshot(): Promise<AgentContextSnapshot>;
  fork(): Promise<AgentContext>;
  exportPersistedSnapshot(): Promise<PersistedAgentContextSnapshot>;
  restorePersistedSnapshot(snapshot: PersistedAgentContextSnapshot): Promise<void>;
  appendEvents(events: Event[]): Promise<void>;
  appendMessages(messages: LlmMessage[]): Promise<void>;
  appendAssistantTurn(message: AssistantMessage): Promise<void>;
  appendToolResult(input: { toolCallId: string; content: string }): Promise<void>;
  replaceMessages(messages: LlmMessage[]): Promise<void>;
  getDashboardSummary(input?: {
    limit?: number;
    previewLength?: number;
  }): Promise<AgentContextDashboardSummary>;
}
