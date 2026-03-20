import type { LlmMessage } from "../llm/types.js";
import { createAgentSystemPrompt } from "../agents/main-engine/system-prompt.js";
import type { AgentContext, AgentContextSnapshot, AssistantMessage } from "./agent-context.js";

type DefaultAgentContextOptions = {
  systemPrompt?: string;
  systemPromptFactory?: () => Promise<string> | string;
};

export class DefaultAgentContext implements AgentContext {
  private readonly systemPrompt: string | (() => Promise<string> | string);
  private readonly messages: LlmMessage[] = [];

  public constructor({ systemPrompt, systemPromptFactory }: DefaultAgentContextOptions) {
    this.systemPrompt =
      systemPromptFactory ??
      systemPrompt ??
      createAgentSystemPrompt({
        botQQ: "unknown",
      });
  }

  public async getSnapshot(): Promise<AgentContextSnapshot> {
    return {
      systemPrompt: await this.getSystemPrompt(),
      messages: this.messages.slice(),
    };
  }

  public async appendMessages(messages: LlmMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    this.messages.push(...messages);
  }

  public async appendAssistantTurn(message: AssistantMessage): Promise<void> {
    this.messages.push(message);
  }

  public async appendToolResult(input: { toolCallId: string; content: string }): Promise<void> {
    this.messages.push({
      role: "tool",
      toolCallId: input.toolCallId,
      content: input.content,
    });
  }

  public async replaceMessages(messages: LlmMessage[]): Promise<void> {
    this.messages.splice(0, this.messages.length, ...messages);
  }

  private async getSystemPrompt(): Promise<string> {
    if (typeof this.systemPrompt === "function") {
      return await this.systemPrompt();
    }

    return this.systemPrompt;
  }
}
