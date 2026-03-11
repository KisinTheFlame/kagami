import type { AgentContextManager, AssistantMessage } from "./context.manager.js";
import type { Event } from "./event.js";
import type { AgentEventQueue } from "./event.queue.js";
import type { LlmClient } from "../llm/client.js";
import type { ToolSet, ToolSetExecutionResult } from "../tools/index.js";

type AgentLoopDeps = {
  llmClient: LlmClient;
  contextManager: AgentContextManager;
  eventQueue: AgentEventQueue;
  agentTools: ToolSet;
  now?: () => Date;
};

const BEIJING_TIME_ZONE = "Asia/Shanghai";

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly contextManager: AgentContextManager;
  private readonly eventQueue: AgentEventQueue;
  private readonly agentTools: ToolSet;
  private readonly now: () => Date;

  public constructor({ llmClient, contextManager, eventQueue, agentTools, now }: AgentLoopDeps) {
    this.llmClient = llmClient;
    this.contextManager = contextManager;
    this.eventQueue = eventQueue;
    this.agentTools = agentTools;
    this.now = now ?? (() => new Date());
  }

  public async run(): Promise<void> {
    while (true) {
      const shouldAddWakeReminder = this.eventQueue.size() === 0;
      await this.eventQueue.waitForEvent();
      if (shouldAddWakeReminder) {
        this.contextManager.pushUserMessage(createWakeReminder(this.now()));
      }

      while (true) {
        for (const event of this.eventQueue.drainAll()) {
          await this.handleEvent(event);
        }

        const completion = await this.llmClient.chat(
          {
            system: await this.contextManager.getSystemPrompt(),
            messages: this.contextManager.getMessages(),
            tools: this.agentTools.definitions(),
            toolChoice: "required",
          },
          {
            usage: "agent",
          },
        );
        const assistant = completion.message;
        const persistentAssistantMessage = omitControlToolCalls(assistant, this.agentTools);
        if (shouldPersistAssistantMessage(persistentAssistantMessage)) {
          this.contextManager.pushAssistantMessage(persistentAssistantMessage);
        }

        let shouldFinishRound = false;
        for (const toolCall of assistant.toolCalls) {
          const toolResult = await this.executeToolCall(toolCall.name, toolCall.arguments);
          if (toolResult.signal === "finish_round") {
            shouldFinishRound = true;
          }
          if (toolResult.kind !== "control" && toolResult.content.length > 0) {
            this.contextManager.pushToolMessage(toolCall.id, toolResult.content);
          }
        }

        if (shouldFinishRound && this.eventQueue.size() === 0) {
          break;
        }
      }
    }
  }

  private async handleEvent(event: Event): Promise<void> {
    await this.contextManager.pushGroupMessageEvent(event);
  }

  private async executeToolCall(
    toolName: string,
    argumentsValue: Record<string, unknown>,
  ): Promise<ToolSetExecutionResult> {
    return await this.agentTools.execute(toolName, argumentsValue, {});
  }
}

function createWakeReminder(now: Date): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return `<system_reminder>当前时间为北京时间 ${values.year} 年 ${values.month} 月 ${values.day} 日 ${values.hour}:${values.minute}</system_reminder>`;
}

function omitControlToolCalls(message: AssistantMessage, agentTools: ToolSet): AssistantMessage {
  return {
    ...message,
    toolCalls: message.toolCalls.filter(
      toolCall => agentTools.getKind(toolCall.name) !== "control",
    ),
  };
}

function shouldPersistAssistantMessage(message: AssistantMessage): boolean {
  return message.content.trim().length > 0 || message.toolCalls.length > 0;
}
