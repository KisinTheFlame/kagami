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
  private lastWakeReminderAt: Date | null = null;

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
    if (isSameWakeReminderMinute(this.lastWakeReminderAt, input.now)) {
      return;
    }

    this.messages.push(createWakeReminderMessage(input.now));
    this.lastWakeReminderAt = new Date(input.now);
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

function isSameWakeReminderMinute(previous: Date | null, current: Date): boolean {
  if (previous === null) {
    return false;
  }

  return createWakeReminderMinuteKey(previous) === createWakeReminderMinuteKey(current);
}

function createWakeReminderMinuteKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return [values.year, values.month, values.day, values.hour, values.minute].join("-");
}
