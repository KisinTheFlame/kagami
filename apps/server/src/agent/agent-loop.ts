import type { AgentContextManager } from "./context-manager.manager.js";
import type { Event } from "./event.js";
import { formatEventToUserMessage } from "./event.js";
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
};

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly contextManager: AgentContextManager;
  private readonly eventQueue: AgentEventQueue;
  private readonly activeTools: AgentToolDefinition[];
  private readonly activeToolMap: AgentToolRegistry;

  public constructor({ llmClient, contextManager, eventQueue, toolRegistry }: AgentLoopDeps) {
    this.llmClient = llmClient;
    this.contextManager = contextManager;
    this.eventQueue = eventQueue;
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
      await this.eventQueue.waitForEvent();

      while (true) {
        for (const event of this.eventQueue.drainAll()) {
          this.handleEvent(event);
        }

        const completion = await this.llmClient.chat({
          system: await this.contextManager.getSystemPrompt(),
          messages: this.contextManager.getMessages(),
          tools: this.activeTools.map(toolDefinition => toolDefinition.tool),
          toolChoice: "auto",
        });
        const assistant = completion.message;
        this.contextManager.pushAssistantMessage(assistant);

        let shouldFinishRound = false;
        for (const toolCall of assistant.toolCalls) {
          const toolResult = await this.executeToolCall(toolCall.name, toolCall.arguments);
          if (toolResult.shouldFinishRound) {
            shouldFinishRound = true;
          }
          this.contextManager.pushToolMessage(toolCall.id, toolResult.content);
        }

        if (shouldFinishRound && this.eventQueue.size() === 0) {
          break;
        }
      }
    }
  }

  private handleEvent(event: Event): void {
    const userMessage = formatEventToUserMessage(event);
    if (userMessage !== null) {
      this.contextManager.pushUserMessage(userMessage);
    }
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
