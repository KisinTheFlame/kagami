import type { Event } from "../agent/event.js";
import type { LlmMessage } from "../llm/types.js";

export type AssistantMessage = Extract<LlmMessage, { role: "assistant" }>;

export type AgentContextSnapshot = {
  systemPrompt: string;
  messages: LlmMessage[];
};

export interface ContextEventEnricher {
  enrichAfterEvent(input: { event: Event; snapshot: AgentContextSnapshot }): Promise<LlmMessage[]>;
}

export interface AgentContext {
  getSnapshot(): Promise<AgentContextSnapshot>;
  recordWake(input: { now: Date }): void;
  recordEvent(event: Event): Promise<void>;
  recordAssistantTurn(message: AssistantMessage): void;
  recordToolResult(input: { toolCallId: string; content: string }): void;
}
