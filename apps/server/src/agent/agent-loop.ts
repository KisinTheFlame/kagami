import type { AgentContextManager, AssistantMessage } from "./context-manager.manager.js";
import type { Event } from "./event.js";
import type { AgentEventQueue } from "./event-queue.queue.js";
import { FINISH_TOOL_NAME } from "./tools/finish.js";
import { SEARCH_WEB_TOOL_NAME } from "./tools/search-web.js";
import { SEND_GROUP_MESSAGE_TOOL_NAME } from "./tools/send-group-message.js";
import type { LlmClient } from "../llm/client.js";
import type { AgentToolDefinition, AgentToolRegistry, ToolExecutionResult } from "./tools/index.js";

const ENABLED_TOOL_NAMES = [SEARCH_WEB_TOOL_NAME, SEND_GROUP_MESSAGE_TOOL_NAME, FINISH_TOOL_NAME];

type AgentLoopDeps = {
  llmClient: LlmClient;
  contextManager: AgentContextManager;
  eventQueue: AgentEventQueue;
  toolRegistry: AgentToolRegistry;
  now?: () => Date;
};

const BEIJING_TIME_ZONE = "Asia/Shanghai";

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly contextManager: AgentContextManager;
  private readonly eventQueue: AgentEventQueue;
  private readonly activeTools: AgentToolDefinition[];
  private readonly activeToolMap: AgentToolRegistry;
  private readonly now: () => Date;

  public constructor({ llmClient, contextManager, eventQueue, toolRegistry, now }: AgentLoopDeps) {
    this.llmClient = llmClient;
    this.contextManager = contextManager;
    this.eventQueue = eventQueue;
    this.now = now ?? (() => new Date());
    this.activeTools = ENABLED_TOOL_NAMES.map(toolName => {
      const toolDefinition = toolRegistry[toolName];
      if (!toolDefinition) {
        throw new Error(`Agent tool is not registered: ${toolName}`);
      }

      return toolDefinition;
    });
    this.activeToolMap = Object.fromEntries(
      this.activeTools.map(toolDefinition => [toolDefinition.tool.name, toolDefinition]),
    );
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

        const completion = await this.llmClient.chat({
          system: await this.contextManager.getSystemPrompt(),
          messages: this.contextManager.getMessages(),
          tools: this.activeTools.map(toolDefinition => toolDefinition.tool),
          toolChoice: "required",
        });
        const assistant = completion.message;
        const persistentAssistantMessage = omitFinishToolCalls(assistant);
        if (shouldPersistAssistantMessage(persistentAssistantMessage)) {
          this.contextManager.pushAssistantMessage(persistentAssistantMessage);
        }

        let shouldFinishRound = false;
        for (const toolCall of assistant.toolCalls) {
          const toolResult = await this.executeToolCall(toolCall.name, toolCall.arguments);
          if (toolResult.shouldFinishRound) {
            shouldFinishRound = true;
          }
          if (toolCall.name !== FINISH_TOOL_NAME && toolResult.content.length > 0) {
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
  ): Promise<ToolExecutionResult> {
    const toolDefinition = this.activeToolMap[toolName];
    if (!toolDefinition) {
      return {
        content: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
        shouldFinishRound: false,
      };
    }

    return toolDefinition.execute(argumentsValue);
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

function omitFinishToolCalls(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    toolCalls: message.toolCalls.filter(toolCall => toolCall.name !== FINISH_TOOL_NAME),
  };
}

function shouldPersistAssistantMessage(message: AssistantMessage): boolean {
  return message.content.trim().length > 0 || message.toolCalls.length > 0;
}
