import { createAgentSystemPrompt } from "./context.js";
import type { AgentContextManager, AssistantMessage } from "./context-manager.manager.js";
import type { LlmMessage } from "../llm/types.js";

type DefaultAgentContextManagerOptions = {
  systemPrompt?: string;
  systemPromptFactory?: () => Promise<string> | string;
};

export class DefaultAgentContextManager implements AgentContextManager {
  private readonly systemPrompt: string | (() => Promise<string> | string);
  private readonly messages: LlmMessage[];
  private steps = 0;

  public constructor({ systemPrompt, systemPromptFactory }: DefaultAgentContextManagerOptions) {
    this.systemPrompt =
      systemPromptFactory ??
      systemPrompt ??
      createAgentSystemPrompt({
        botQQ: "unknown",
      });
    this.messages = [];
  }

  public async getSystemPrompt(): Promise<string> {
    if (typeof this.systemPrompt === "function") {
      return await this.systemPrompt();
    }

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
