import type { AgentContext, AssistantMessage } from "../context/agent-context.js";
import {
  createConversationSummaryMessage,
  createWakeReminderMessage,
} from "../context/context-message-factory.js";
import type { ToolExecutor, ToolSetExecutionResult } from "@kagami/agent-runtime";
import type { Event } from "../event/event.js";
import type { AgentEventQueue } from "../event/event.queue.js";
import type { LlmClient } from "../../../llm/client.js";
import type { Tool } from "../../../llm/types.js";
import type { ContextSummaryOperation } from "../../capabilities/context-summary/operations/context-summary.operation.js";

type ContextSummaryLike =
  | Pick<ContextSummaryOperation, "execute">
  | {
      summarize(input: {
        messages: import("../../../llm/types.js").LlmMessage[];
        tools: Tool[];
      }): Promise<string | null>;
    };

type RootAgentRuntimeDeps = {
  llmClient: LlmClient;
  context: AgentContext;
  eventQueue: AgentEventQueue;
  tools?: ToolExecutor;
  agentTools?: ToolExecutor;
  contextSummaryOperation?: ContextSummaryLike;
  summaryPlanner?: ContextSummaryLike;
  summaryTools?: Tool[];
  contextCompactionThreshold?: number;
  now?: () => Date;
};

const DEFAULT_CONTEXT_COMPACTION_THRESHOLD = 60;

export class RootAgentRuntime {
  private readonly llmClient: LlmClient;
  private readonly context: AgentContext;
  private readonly eventQueue: AgentEventQueue;
  private readonly tools: ToolExecutor;
  private readonly contextSummaryOperation?: ContextSummaryLike;
  private readonly summaryTools: Tool[];
  private readonly contextCompactionThreshold: number;
  private readonly now: () => Date;
  private lastWakeReminderAt: Date | null = null;

  public constructor({
    llmClient,
    context,
    eventQueue,
    tools,
    agentTools,
    contextSummaryOperation,
    summaryPlanner,
    summaryTools,
    contextCompactionThreshold,
    now,
  }: RootAgentRuntimeDeps) {
    this.llmClient = llmClient;
    this.context = context;
    this.eventQueue = eventQueue;
    this.tools = tools ?? agentTools ?? failMissingTools();
    this.contextSummaryOperation = contextSummaryOperation ?? summaryPlanner;
    this.summaryTools = summaryTools ?? [];
    this.contextCompactionThreshold =
      contextCompactionThreshold ?? DEFAULT_CONTEXT_COMPACTION_THRESHOLD;
    this.now = now ?? (() => new Date());
  }

  public async run(): Promise<void> {
    while (true) {
      const shouldAddWakeReminder = this.eventQueue.size() === 0;
      await this.eventQueue.waitForEvent();
      if (shouldAddWakeReminder) {
        await this.appendWakeReminderIfNeeded(this.now());
      }

      let hasActiveRound = false;
      let currentGroupId: string | null = null;

      while (true) {
        const events = this.eventQueue.drainAll();
        if (events.length > 0) {
          hasActiveRound = true;
          currentGroupId = extractCurrentGroupId(events, currentGroupId);
          await this.handleEvents(events);
        } else if (!hasActiveRound) {
          break;
        }

        const snapshot = await this.context.getSnapshot();
        const completion = await this.llmClient.chat(
          {
            system: snapshot.systemPrompt,
            messages: snapshot.messages,
            tools: this.tools.definitions(),
            toolChoice: "required",
          },
          {
            usage: "agent",
          },
        );
        const assistant = completion.message;
        const persistentAssistantMessage = omitControlToolCalls(assistant, this.tools);
        if (shouldPersistAssistantMessage(persistentAssistantMessage)) {
          await this.context.appendAssistantTurn(persistentAssistantMessage);
          await this.compactContextIfNeeded();
        }

        let shouldFinishRound = false;
        for (const toolCall of assistant.toolCalls) {
          const toolResult = await this.executeToolCall(toolCall.name, toolCall.arguments, {
            groupId: currentGroupId ?? undefined,
            systemPrompt: snapshot.systemPrompt,
            messages: snapshot.messages,
          });
          if (toolResult.signal === "finish_round") {
            shouldFinishRound = true;
          }
          if (toolResult.content.length > 0) {
            await this.context.appendToolResult({
              toolCallId: toolCall.id,
              content: toolResult.content,
            });
            await this.compactContextIfNeeded();
          }
          if (shouldFinishRound) {
            break;
          }
        }

        if (shouldFinishRound && this.eventQueue.size() === 0) {
          break;
        }
      }
    }
  }

  private async handleEvents(events: Event[]): Promise<void> {
    await this.context.appendEvents(events);
    await this.compactContextIfNeeded();
  }

  private async executeToolCall(
    toolName: string,
    argumentsValue: Record<string, unknown>,
    context: {
      groupId?: string;
      systemPrompt?: string;
      messages?: import("../../../llm/types.js").LlmMessage[];
    },
  ): Promise<ToolSetExecutionResult> {
    const toolContext = {
      ...context,
      agentContext: this.context,
    };

    return await this.tools.execute(toolName, argumentsValue, toolContext);
  }

  private async appendWakeReminderIfNeeded(now: Date): Promise<void> {
    if (isSameWakeReminderMinute(this.lastWakeReminderAt, now)) {
      return;
    }

    await this.context.appendMessages([createWakeReminderMessage(now)]);
    this.lastWakeReminderAt = new Date(now);
    await this.compactContextIfNeeded();
  }

  private async compactContextIfNeeded(): Promise<void> {
    if (!this.contextSummaryOperation) {
      return;
    }

    const snapshot = await this.context.getSnapshot();
    if (snapshot.messages.length <= this.contextCompactionThreshold) {
      return;
    }

    const splitIndex = Math.floor(snapshot.messages.length / 2);
    if (splitIndex <= 0 || splitIndex >= snapshot.messages.length) {
      return;
    }

    const summary =
      "execute" in this.contextSummaryOperation
        ? await this.contextSummaryOperation.execute({
            messages: snapshot.messages.slice(0, splitIndex),
            tools: this.summaryTools,
          })
        : await this.contextSummaryOperation.summarize({
            messages: snapshot.messages.slice(0, splitIndex),
            tools: this.summaryTools,
          });
    if (!summary) {
      return;
    }

    await this.context.replaceMessages([
      createConversationSummaryMessage(summary),
      ...snapshot.messages.slice(splitIndex),
    ]);
  }
}

function failMissingTools(): never {
  throw new Error("RootAgentRuntime requires tools");
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

function extractCurrentGroupId(events: Event[], fallback: string | null): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "napcat_group_message") {
      return event.groupId;
    }
  }

  return fallback;
}
