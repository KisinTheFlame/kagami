import { AgentContextManager } from "./context-manager.js";
import type { AgentEventQueue } from "./event-queue.js";
import type { LlmClient } from "../llm/client.js";
import { AGENT_TOOLS, executeToolCall } from "./tools.js";

type AgentLoopDeps = {
  llmClient: LlmClient;
  contextManager: AgentContextManager;
  eventQueue: AgentEventQueue;
};

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly contextManager: AgentContextManager;
  private readonly eventQueue: AgentEventQueue;

  public constructor({ llmClient, contextManager, eventQueue }: AgentLoopDeps) {
    this.llmClient = llmClient;
    this.contextManager = contextManager;
    this.eventQueue = eventQueue;
  }

  public async run(): Promise<void> {
    while (true) {
      await this.eventQueue.waitForEvent();

      while (true) {
        for (const event of this.eventQueue.drainAll()) {
          this.contextManager.pushUserMessage(event.message);
        }

        const completion = await this.llmClient.chat({
          system: this.contextManager.getSystemPrompt(),
          messages: this.contextManager.getMessages(),
          tools: AGENT_TOOLS, // TODO: tool manager
          toolChoice: "auto",
        });
        const assistant = completion.message;
        this.contextManager.pushAssistantMessage(assistant);

        let shouldFinishRound = false;
        for (const toolCall of assistant.toolCalls) {
          const toolResult = await executeToolCall(toolCall);
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
}
