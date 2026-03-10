import { createAgentSystemPrompt } from "./context.js";
import type { AgentContextManager, AssistantMessage } from "./context-manager.manager.js";
import { formatEventToUserMessage } from "./event.js";
import type { Event } from "./event.js";
import type { LlmMessage } from "../llm/types.js";
import type { RagQueryPlannerService } from "../rag/query-planner.service.js";

type DefaultAgentContextManagerOptions = {
  systemPrompt?: string;
  systemPromptFactory?: () => Promise<string> | string;
  ragQueryPlanner?: RagQueryPlannerService;
};

export class DefaultAgentContextManager implements AgentContextManager {
  private readonly systemPrompt: string | (() => Promise<string> | string);
  private readonly messages: LlmMessage[];
  private readonly ragQueryPlanner?: RagQueryPlannerService;
  private steps = 0;

  public constructor({
    systemPrompt,
    systemPromptFactory,
    ragQueryPlanner,
  }: DefaultAgentContextManagerOptions) {
    this.systemPrompt =
      systemPromptFactory ??
      systemPrompt ??
      createAgentSystemPrompt({
        botQQ: "unknown",
      });
    this.messages = [];
    this.ragQueryPlanner = ragQueryPlanner;
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

  public async pushGroupMessageEvent(event: Event): Promise<void> {
    const currentMessage = formatEventToUserMessage(event);
    if (currentMessage === null) {
      return;
    }

    this.pushUserMessage(currentMessage);

    if (event.type === "napcat_group_message" && this.ragQueryPlanner) {
      const memoryMessage = await this.ragQueryPlanner.plan({
        groupId: event.groupId,
        currentMessage,
        contextMessages: this.messages,
      });
      if (memoryMessage) {
        this.pushUserMessage(memoryMessage);
      }
    }
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
