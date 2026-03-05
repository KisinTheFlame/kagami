import { AGENT_SYSTEM_PROMPT } from "./context.js";
import type { AgentContextManager, AssistantMessage } from "./context-manager.manager.js";
import type { LlmMessage } from "../llm/types.js";

type DefaultAgentContextManagerOptions = {
  systemPrompt?: string;
};

export class DefaultAgentContextManager implements AgentContextManager {
  private readonly systemPrompt: string;
  private readonly messages: LlmMessage[];
  private steps = 0;

  public constructor({ systemPrompt }: DefaultAgentContextManagerOptions) {
    this.systemPrompt = systemPrompt ?? AGENT_SYSTEM_PROMPT;
    this.messages = [];
  }

  public getSystemPrompt(): string {
    return this.systemPrompt;
  }

  public getMessages(): LlmMessage[] {
    return this.messages;
  }

  public getSteps(): number {
    return this.steps;
  }

  public pushUserMessage(content: string): void {
    this.messages.push({
      role: "user",
      content,
    });
  }

  public pushAssistantMessage(message: AssistantMessage): string | null {
    this.steps += 1;
    this.messages.push(message);

    const output = message.content.trim();
    return output.length > 0 ? output : null;
  }

  public pushToolMessage(toolCallId: string, content: string): void {
    this.messages.push({
      role: "tool",
      toolCallId,
      content,
    });
  }
}
