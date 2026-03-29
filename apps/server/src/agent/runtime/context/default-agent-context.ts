import type { LlmMessage } from "../../../llm/types.js";
import { createAgentSystemPrompt } from "../root-agent/system-prompt.js";
import { createMessagesFromEvent } from "./context-message-factory.js";
import type {
  AgentContext,
  AgentContextSnapshot,
  AssistantMessage,
  ContextItem,
} from "./agent-context.js";
import type { Event } from "../event/event.js";

type DefaultAgentContextOptions = {
  systemPrompt?: string;
  systemPromptFactory?: () => Promise<string> | string;
};

export class DefaultAgentContext implements AgentContext {
  private readonly systemPrompt: string | (() => Promise<string> | string);
  private readonly items: ContextItem[] = [];

  public constructor({ systemPrompt, systemPromptFactory }: DefaultAgentContextOptions) {
    this.systemPrompt =
      systemPromptFactory ??
      systemPrompt ??
      createAgentSystemPrompt({
        botQQ: "unknown",
        creatorName: "unknown",
        creatorQQ: "unknown",
      });
  }

  public async getSnapshot(): Promise<AgentContextSnapshot> {
    return {
      systemPrompt: await this.getSystemPrompt(),
      messages: this.items.flatMap(renderContextItemToMessages),
    };
  }

  public async fork(): Promise<AgentContext> {
    const snapshot = await this.getSnapshot();
    const forkedContext = new DefaultAgentContext({
      systemPrompt: snapshot.systemPrompt,
    });

    await forkedContext.appendMessages(cloneMessages(snapshot.messages));

    return forkedContext;
  }

  public async appendEvents(events: Event[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    this.items.push(...events.map(event => ({ kind: "event", event }) as const));
  }

  public async appendMessages(messages: LlmMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    this.items.push(...messages.map(message => ({ kind: "llm_message", message }) as const));
  }

  public async appendAssistantTurn(message: AssistantMessage): Promise<void> {
    this.items.push({
      kind: "llm_message",
      message,
    });
  }

  public async appendToolResult(input: { toolCallId: string; content: string }): Promise<void> {
    this.items.push({
      kind: "llm_message",
      message: {
        role: "tool",
        toolCallId: input.toolCallId,
        content: input.content,
      },
    });
  }

  public async replaceMessages(messages: LlmMessage[]): Promise<void> {
    this.items.splice(
      0,
      this.items.length,
      ...messages.map(message => ({ kind: "llm_message", message }) as const),
    );
  }

  private async getSystemPrompt(): Promise<string> {
    if (typeof this.systemPrompt === "function") {
      return await this.systemPrompt();
    }

    return this.systemPrompt;
  }
}

function renderContextItemToMessages(item: ContextItem): LlmMessage[] {
  if (item.kind === "llm_message") {
    return [item.message];
  }

  return createMessagesFromEvent(item.event);
}

function cloneMessages(messages: LlmMessage[]): LlmMessage[] {
  return structuredClone(messages);
}
