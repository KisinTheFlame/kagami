import type { LlmMessage } from "../llm/types.js";

export type AssistantMessage = Extract<LlmMessage, { role: "assistant" }>;

export type AgentContextSnapshot = {
  systemPrompt: string;
  messages: LlmMessage[];
};

export interface AgentContext {
  getSnapshot(): Promise<AgentContextSnapshot>;
  appendMessages(messages: LlmMessage[]): Promise<void>;
  appendAssistantTurn(message: AssistantMessage): Promise<void>;
  appendToolResult(input: { toolCallId: string; content: string }): Promise<void>;
  replaceMessages(messages: LlmMessage[]): Promise<void>;
}
