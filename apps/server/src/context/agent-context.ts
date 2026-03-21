import type { LlmMessage } from "../llm/types.js";
import type { Event } from "../event/event.js";

export type AssistantMessage = Extract<LlmMessage, { role: "assistant" }>;
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
  appendEvents(events: Event[]): Promise<void>;
  appendMessages(messages: LlmMessage[]): Promise<void>;
  appendAssistantTurn(message: AssistantMessage): Promise<void>;
  appendToolResult(input: { toolCallId: string; content: string }): Promise<void>;
  replaceMessages(messages: LlmMessage[]): Promise<void>;
}
