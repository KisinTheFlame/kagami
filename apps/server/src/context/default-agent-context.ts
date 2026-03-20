import type { Event } from "../agent/event.js";
import type { LlmMessage } from "../llm/types.js";
import type {
  AgentContext,
  AgentContextSnapshot,
  AssistantMessage,
  ContextEventEnricher,
} from "./agent-context.js";
import type { ContextSummaryPlanner } from "./context-summary-planner.service.js";
import {
  createConversationSummaryMessage,
  createMessagesFromEvent,
  createWakeReminderMessage,
} from "./context-message-factory.js";
import { createAgentSystemPrompt } from "./system-prompt.js";

const DEFAULT_CONTEXT_COMPACTION_THRESHOLD = 60;

type DefaultAgentContextOptions = {
  systemPrompt?: string;
  systemPromptFactory?: () => Promise<string> | string;
  eventEnricher?: ContextEventEnricher;
  summaryPlanner?: ContextSummaryPlanner;
  summaryTools?: {
    name: string;
    description?: string;
    parameters: { type: "object"; properties: Record<string, unknown> };
  }[];
  contextCompactionThreshold?: number;
};

export class DefaultAgentContext implements AgentContext {
  private readonly systemPrompt: string | (() => Promise<string> | string);
  private readonly eventEnricher?: ContextEventEnricher;
  private readonly summaryPlanner?: ContextSummaryPlanner;
  private readonly summaryTools: {
    name: string;
    description?: string;
    parameters: { type: "object"; properties: Record<string, unknown> };
  }[];
  private readonly contextCompactionThreshold: number;
  private readonly messages: LlmMessage[] = [];
  private lastWakeReminderAt: Date | null = null;

  public constructor({
    systemPrompt,
    systemPromptFactory,
    eventEnricher,
    summaryPlanner,
    summaryTools,
    contextCompactionThreshold,
  }: DefaultAgentContextOptions) {
    this.systemPrompt =
      systemPromptFactory ??
      systemPrompt ??
      createAgentSystemPrompt({
        botQQ: "unknown",
      });
    this.eventEnricher = eventEnricher;
    this.summaryPlanner = summaryPlanner;
    this.summaryTools = summaryTools ?? [];
    this.contextCompactionThreshold =
      contextCompactionThreshold ?? DEFAULT_CONTEXT_COMPACTION_THRESHOLD;
  }

  public async getSnapshot(): Promise<AgentContextSnapshot> {
    return {
      systemPrompt: await this.getSystemPrompt(),
      messages: this.messages.slice(),
    };
  }

  public async recordWake(input: { now: Date }): Promise<void> {
    if (isSameWakeReminderMinute(this.lastWakeReminderAt, input.now)) {
      return;
    }

    this.messages.push(createWakeReminderMessage(input.now));
    this.lastWakeReminderAt = new Date(input.now);
    await this.compactIfNeeded();
  }

  public async recordEvent(event: Event): Promise<void> {
    await this.recordEvents([event]);
  }

  public async recordEvents(events: Event[]): Promise<void> {
    const eventMessages = events.flatMap(event => createMessagesFromEvent(event));
    if (eventMessages.length === 0) {
      return;
    }

    this.messages.push(...eventMessages);

    if (!this.eventEnricher) {
      await this.compactIfNeeded();
      return;
    }

    const enrichedMessages = await this.eventEnricher.enrichAfterEvents({
      events,
      snapshot: await this.getSnapshot(),
    });
    if (enrichedMessages.length === 0) {
      await this.compactIfNeeded();
      return;
    }

    this.messages.push(...enrichedMessages);
    await this.compactIfNeeded();
  }

  public async recordAssistantTurn(message: AssistantMessage): Promise<void> {
    this.messages.push(message);
    await this.compactIfNeeded();
  }

  public async recordToolResult(input: { toolCallId: string; content: string }): Promise<void> {
    this.messages.push({
      role: "tool",
      toolCallId: input.toolCallId,
      content: input.content,
    });
    await this.compactIfNeeded();
  }

  private async getSystemPrompt(): Promise<string> {
    if (typeof this.systemPrompt === "function") {
      return await this.systemPrompt();
    }

    return this.systemPrompt;
  }

  private async compactIfNeeded(): Promise<void> {
    if (!this.summaryPlanner || this.messages.length <= this.contextCompactionThreshold) {
      return;
    }

    const splitIndex = Math.floor(this.messages.length / 2);
    if (splitIndex <= 0 || splitIndex >= this.messages.length) {
      return;
    }

    const summary = await this.summaryPlanner.summarize({
      systemPrompt: await this.getSystemPrompt(),
      messages: this.messages.slice(0, splitIndex),
      tools: this.summaryTools,
    });
    if (!summary) {
      return;
    }

    const recentMessages = this.messages.slice(splitIndex);
    this.messages.splice(
      0,
      this.messages.length,
      createConversationSummaryMessage(summary),
      ...recentMessages,
    );
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
