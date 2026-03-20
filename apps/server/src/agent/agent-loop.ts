import type { Event } from "./event.js";
import type { AgentEventQueue } from "./event.queue.js";
import type { AgentContext, AssistantMessage } from "../context/agent-context.js";
import type { LlmClient } from "../llm/client.js";
import type { ToolExecutor, ToolSetExecutionResult } from "../tools/index.js";

type AgentLoopDeps = {
  llmClient: LlmClient;
  context: AgentContext;
  eventQueue: AgentEventQueue;
  agentTools: ToolExecutor;
  now?: () => Date;
};

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly context: AgentContext;
  private readonly eventQueue: AgentEventQueue;
  private readonly agentTools: ToolExecutor;
  private readonly now: () => Date;

  public constructor({ llmClient, context, eventQueue, agentTools, now }: AgentLoopDeps) {
    this.llmClient = llmClient;
    this.context = context;
    this.eventQueue = eventQueue;
    this.agentTools = agentTools;
    this.now = now ?? (() => new Date());
  }

  public async run(): Promise<void> {
    while (true) {
      const shouldAddWakeReminder = this.eventQueue.size() === 0;
      await this.eventQueue.waitForEvent();
      if (shouldAddWakeReminder) {
        await this.context.recordWake({ now: this.now() });
      }

      while (true) {
        const events = this.eventQueue.drainAll();
        if (events.length > 0) {
          await this.handleEvents(events);
        }
        const snapshot = await this.context.getSnapshot();

        const completion = await this.llmClient.chat(
          {
            system: snapshot.systemPrompt,
            messages: snapshot.messages,
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
          await this.context.recordAssistantTurn(persistentAssistantMessage);
        }

        let shouldFinishRound = false;
        for (const toolCall of assistant.toolCalls) {
          const toolResult = await this.executeToolCall(toolCall.name, toolCall.arguments);
          if (toolResult.signal === "finish_round") {
            shouldFinishRound = true;
          }
          if (toolResult.kind !== "control" && toolResult.content.length > 0) {
            await this.context.recordToolResult({
              toolCallId: toolCall.id,
              content: toolResult.content,
            });
          }
        }

        if (shouldFinishRound && this.eventQueue.size() === 0) {
          break;
        }
      }
    }
  }

  private async handleEvents(events: Event[]): Promise<void> {
    await this.context.recordEvents(events);
  }

  private async executeToolCall(
    toolName: string,
    argumentsValue: Record<string, unknown>,
  ): Promise<ToolSetExecutionResult> {
    return await this.agentTools.execute(toolName, argumentsValue, {});
  }
}

function omitControlToolCalls(
  message: AssistantMessage,
  agentTools: ToolExecutor,
): AssistantMessage {
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
