import type { Event } from "../agent/event.js";
import type { LlmMessage } from "../llm/types.js";
import type {
  AgentContext,
  AgentContextSnapshot,
  AssistantMessage,
  ContextEventEnricher,
} from "./agent-context.js";
import { createMessagesFromEvent, createWakeReminderMessage } from "./context-message-factory.js";
import { createAgentSystemPrompt } from "./system-prompt.js";

type DefaultAgentContextOptions = {
  systemPrompt?: string;
  systemPromptFactory?: () => Promise<string> | string;
  eventEnricher?: ContextEventEnricher;
};

export class DefaultAgentContext implements AgentContext {
  private readonly systemPrompt: string | (() => Promise<string> | string);
  private readonly eventEnricher?: ContextEventEnricher;
  private readonly messages: LlmMessage[] = [];

  public constructor({
    systemPrompt,
    systemPromptFactory,
    eventEnricher,
  }: DefaultAgentContextOptions) {
    this.systemPrompt =
      systemPromptFactory ??
      systemPrompt ??
      createAgentSystemPrompt({
        botQQ: "unknown",
      });
    this.eventEnricher = eventEnricher;
  }

  public async getSnapshot(): Promise<AgentContextSnapshot> {
    return {
      systemPrompt: await this.getSystemPrompt(),
      messages: this.messages.slice(),
    };
  }

  public recordWake(input: { now: Date }): void {
    this.messages.push(createWakeReminderMessage(input.now));
  }

  public async recordEvent(event: Event): Promise<void> {
    const eventMessages = createMessagesFromEvent(event);
    if (eventMessages.length === 0) {
      return;
    }

    this.messages.push(...eventMessages);

    if (!this.eventEnricher) {
      return;
    }

    const enrichedMessages = await this.eventEnricher.enrichAfterEvent({
      event,
      snapshot: await this.getSnapshot(),
    });
    if (enrichedMessages.length === 0) {
      return;
    }

    this.messages.push(...enrichedMessages);
  }

  public recordAssistantTurn(message: AssistantMessage): void {
    this.messages.push(message);
  }

  public recordToolResult(input: { toolCallId: string; content: string }): void {
    this.messages.push({
      role: "tool",
      toolCallId: input.toolCallId,
      content: input.content,
    });
  }

  private async getSystemPrompt(): Promise<string> {
    if (typeof this.systemPrompt === "function") {
      return await this.systemPrompt();
    }

    return this.systemPrompt;
  }
}
