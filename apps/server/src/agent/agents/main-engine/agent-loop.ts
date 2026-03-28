import type { AgentContext, AssistantMessage } from "../../context/agent-context.js";
import {
  createConversationSummaryMessage,
  createWakeReminderMessage,
} from "../../context/context-message-factory.js";
import type { Event } from "../../event/event.js";
import type { AgentEventQueue } from "../../event/event.queue.js";
import type { LlmClient } from "../../../llm/client.js";
import type { Tool } from "../../../llm/types.js";
import type { ToolExecutor, ToolSetExecutionResult } from "../../tools/index.js";
import type { ContextSummaryPlanner } from "../subagents/context-summarizer/context-summary-planner.service.js";
import type { LoopRunRecorder } from "../../service/loop-run-recorder.service.js";

type AgentLoopDeps = {
  llmClient: LlmClient;
  context: AgentContext;
  eventQueue: AgentEventQueue;
  agentTools: ToolExecutor;
  summaryPlanner?: ContextSummaryPlanner;
  summaryTools?: Tool[];
  contextCompactionThreshold?: number;
  now?: () => Date;
  loopRunRecorder?: LoopRunRecorder;
};

const DEFAULT_CONTEXT_COMPACTION_THRESHOLD = 60;

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly context: AgentContext;
  private readonly eventQueue: AgentEventQueue;
  private readonly agentTools: ToolExecutor;
  private readonly summaryPlanner?: ContextSummaryPlanner;
  private readonly summaryTools: Tool[];
  private readonly contextCompactionThreshold: number;
  private readonly now: () => Date;
  private readonly loopRunRecorder?: LoopRunRecorder;
  private lastWakeReminderAt: Date | null = null;

  public constructor({
    llmClient,
    context,
    eventQueue,
    agentTools,
    summaryPlanner,
    summaryTools,
    contextCompactionThreshold,
    now,
    loopRunRecorder,
  }: AgentLoopDeps) {
    this.llmClient = llmClient;
    this.context = context;
    this.eventQueue = eventQueue;
    this.agentTools = agentTools;
    this.summaryPlanner = summaryPlanner;
    this.summaryTools = summaryTools ?? [];
    this.contextCompactionThreshold =
      contextCompactionThreshold ?? DEFAULT_CONTEXT_COMPACTION_THRESHOLD;
    this.now = now ?? (() => new Date());
    this.loopRunRecorder = loopRunRecorder;
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
      let currentLoopRunId: string | null = null;
      let currentLoopStartedAt: Date | null = null;
      let currentStepSeq = 1;

      while (true) {
        const events = this.eventQueue.drainAll();
        if (events.length > 0) {
          hasActiveRound = true;
          currentGroupId = extractCurrentGroupId(events, currentGroupId);
          if (!currentLoopRunId) {
            const triggerEvent = extractLatestGroupMessageEvent(events);
            if (triggerEvent && this.loopRunRecorder) {
              currentLoopStartedAt = this.now();
              currentLoopRunId = await this.loopRunRecorder.startRun({
                event: triggerEvent,
                startedAt: currentLoopStartedAt,
              });
            }
          }
          await this.handleEvents(events);
        } else if (!hasActiveRound) {
          break;
        }

        const snapshot = await this.context.getSnapshot();
        let completion;
        try {
          completion = await this.llmClient.chat(
            {
              system: snapshot.systemPrompt,
              messages: snapshot.messages,
              tools: this.agentTools.definitions(),
              toolChoice: "required",
            },
            {
              usage: "agent",
              loopRunId: currentLoopRunId ?? undefined,
              onSettled: async observation => {
                if (!currentLoopRunId || !this.loopRunRecorder) {
                  return;
                }

                await this.loopRunRecorder.recordLlmCall({
                  loopRunId: currentLoopRunId,
                  seq: currentStepSeq,
                  observation,
                });
                currentStepSeq += 1;
              },
            },
          );
        } catch (error) {
          await this.failCurrentLoopRun({
            loopRunId: currentLoopRunId,
            loopStartedAt: currentLoopStartedAt,
            stepSeq: currentStepSeq,
            error,
          });
          throw error;
        }
        const assistant = completion.message;
        const persistentAssistantMessage = omitControlToolCalls(assistant, this.agentTools);
        if (shouldPersistAssistantMessage(persistentAssistantMessage)) {
          await this.context.appendAssistantTurn(persistentAssistantMessage);
          await this.compactContextIfNeeded();
        }

        let shouldFinishRound = false;
        for (const toolCall of assistant.toolCalls) {
          const toolStartedAt = this.now();
          if (currentLoopRunId && this.loopRunRecorder) {
            await this.loopRunRecorder.recordToolCall({
              loopRunId: currentLoopRunId,
              seq: currentStepSeq,
              toolName: toolCall.name,
              toolCallId: toolCall.id,
              argumentsValue: toolCall.arguments,
              startedAt: toolStartedAt,
            });
            currentStepSeq += 1;
          }
          const toolResult = await this.executeToolCall(toolCall.name, toolCall.arguments, {
            groupId: currentGroupId ?? undefined,
            systemPrompt: snapshot.systemPrompt,
            messages: snapshot.messages,
          });
          if (currentLoopRunId && this.loopRunRecorder) {
            await this.loopRunRecorder.recordToolResult({
              loopRunId: currentLoopRunId,
              seq: currentStepSeq,
              toolName: toolCall.name,
              toolCallId: toolCall.id,
              result: toolResult,
              startedAt: toolStartedAt,
              finishedAt: this.now(),
            });
            currentStepSeq += 1;
          }
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
          await this.finishCurrentLoopRun({
            loopRunId: currentLoopRunId,
            loopStartedAt: currentLoopStartedAt,
            stepSeq: currentStepSeq,
            outcome: {
              reason: "finish_round",
              groupId: currentGroupId,
            },
          });
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
    return await this.agentTools.execute(toolName, argumentsValue, context);
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
    if (!this.summaryPlanner) {
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

    const summary = await this.summaryPlanner.summarize({
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

  private async finishCurrentLoopRun(input: {
    loopRunId: string | null;
    loopStartedAt: Date | null;
    stepSeq: number;
    outcome: Record<string, unknown>;
  }): Promise<void> {
    if (!input.loopRunId || !input.loopStartedAt || !this.loopRunRecorder) {
      return;
    }

    await this.loopRunRecorder.finishRun({
      loopRunId: input.loopRunId,
      status: "success",
      startedAt: input.loopStartedAt,
      finishedAt: this.now(),
      outcome: input.outcome,
      seq: input.stepSeq,
    });
  }

  private async failCurrentLoopRun(input: {
    loopRunId: string | null;
    loopStartedAt: Date | null;
    stepSeq: number;
    error: unknown;
  }): Promise<void> {
    if (!input.loopRunId || !input.loopStartedAt || !this.loopRunRecorder) {
      return;
    }

    await this.loopRunRecorder.finishRun({
      loopRunId: input.loopRunId,
      status: "failed",
      startedAt: input.loopStartedAt,
      finishedAt: this.now(),
      outcome: serializeUnknownError(input.error),
      seq: input.stepSeq,
    });
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

function extractLatestGroupMessageEvent(events: Event[]): Event | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "napcat_group_message") {
      return event;
    }
  }

  return null;
}

function serializeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code:
        typeof (error as Error & { code?: unknown }).code === "string"
          ? (error as Error & { code?: string }).code
          : undefined,
    };
  }

  return {
    message: typeof error === "string" ? error : "Unknown error",
  };
}
