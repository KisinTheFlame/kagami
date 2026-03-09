import type { LlmMessage } from "../llm/types.js";

export type AssistantMessage = Extract<LlmMessage, { role: "assistant" }>;

export interface AgentContextManager {
  getSystemPrompt(): Promise<string> | string;
  getMessages(): LlmMessage[];
  getSteps(): number;
  pushUserMessage(content: string): void;
  pushAssistantMessage(message: AssistantMessage): string | null;
  pushToolMessage(toolCallId: string, content: string): void;
}
