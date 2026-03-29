import type { AgentContext, AssistantMessage } from "../context/agent-context.js";
import {
  createConversationSummaryMessage,
  createMessagesFromEvent,
  createWakeReminderMessage,
} from "../context/context-message-factory.js";
import type { ToolExecutor, ToolSetExecutionResult } from "@kagami/agent-runtime";
import type { Event } from "../event/event.js";
import type { AgentEventQueue } from "../event/event.queue.js";
import type { LlmClient } from "../../../llm/client.js";
import type { LlmMessage, Tool } from "../../../llm/types.js";
import type { ContextSummaryOperation } from "../../capabilities/context-summary/operations/context-summary.operation.js";
import type {
  RootAgentPostToolEffects,
  RootAgentSessionController,
} from "./session/root-agent-session.js";
import { WAIT_TOOL_NAME } from "./tools/wait.tool.js";

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
  session: RootAgentSessionController;
  tools?: ToolExecutor;
  agentTools?: ToolExecutor;
  contextSummaryOperation?: ContextSummaryLike;
  summaryPlanner?: ContextSummaryLike;
  summaryTools?: Tool[];
  contextCompactionThreshold?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_CONTEXT_COMPACTION_THRESHOLD = 60;

type PendingToolPersistence = {
  toolResult?: {
    toolCallId: string;
    content: string;
  };
  postToolEffects: RootAgentPostToolEffects;
};

export class RootAgentRuntime {
  private readonly llmClient: LlmClient;
  private readonly context: AgentContext;
  private readonly eventQueue: AgentEventQueue;
  private readonly session: RootAgentSessionController;
  private readonly tools: ToolExecutor;
  private readonly contextSummaryOperation?: ContextSummaryLike;
  private readonly summaryTools: Tool[];
  private readonly contextCompactionThreshold: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastWakeReminderAt: Date | null = null;
  private initialized = false;

  public constructor({
    llmClient,
    context,
    eventQueue,
    session,
    tools,
    agentTools,
    contextSummaryOperation,
    summaryPlanner,
    summaryTools,
    contextCompactionThreshold,
    now,
    sleep,
  }: RootAgentRuntimeDeps) {
    this.llmClient = llmClient;
    this.context = context;
    this.eventQueue = eventQueue;
    this.session = session;
    this.tools = tools ?? agentTools ?? failMissingTools();
    this.contextSummaryOperation = contextSummaryOperation ?? summaryPlanner;
    this.summaryTools = summaryTools ?? [];
    this.contextCompactionThreshold =
      contextCompactionThreshold ?? DEFAULT_CONTEXT_COMPACTION_THRESHOLD;
    this.now = now ?? (() => new Date());
    this.sleep = sleep ?? createSleep;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.session.initializeContext();
    await this.compactContextIfNeeded();
    this.initialized = true;
  }

  public async run(): Promise<void> {
    await this.initialize();
    let shouldRunRound = true;

    while (true) {
      const consumeResult = await this.consumePendingEvents();
      shouldRunRound = shouldRunRound || consumeResult.shouldTriggerRound;

      if (this.session.getState().kind === "waiting") {
        await this.sleep(10);
        continue;
      }

      if (!shouldRunRound) {
        await this.sleep(10);
        continue;
      }
      shouldRunRound = false;

      await this.appendWakeReminderIfNeeded(this.now());

      const snapshot = await this.context.getSnapshot();
      const transientMessages = [...snapshot.messages];
      const completion = await this.llmClient.chat(
        {
          system: snapshot.systemPrompt,
          messages: transientMessages,
          tools: this.tools.definitions(),
          toolChoice: "required",
        },
        {
          usage: "agent",
        },
      );
      const assistant = completion.message;
      const persistentAssistantMessage = omitControlToolCalls(assistant, this.tools);
      const assistantToPersist = shouldPersistAssistantMessage(persistentAssistantMessage)
        ? persistentAssistantMessage
        : null;

      const pendingPersistence: PendingToolPersistence[] = [];
      for (const toolCall of assistant.toolCalls) {
        const toolResult = await this.executeToolCall(toolCall.name, toolCall.arguments, {
          groupId: this.session.getCurrentGroupId(),
          systemPrompt: snapshot.systemPrompt,
          messages: [...transientMessages],
          tools: this.tools,
        });
        const postToolEffects = await this.session.flushPendingPostToolEffects();
        pendingPersistence.push({
          ...(shouldPersistToolResultInContext({
            toolName: toolCall.name,
            toolResult,
          }) && toolResult.content.length > 0
            ? {
                toolResult: {
                  toolCallId: toolCall.id,
                  content: toolResult.content,
                },
              }
            : {}),
          postToolEffects,
        });
        transientMessages.push(
          ...postToolEffects.messages,
          ...postToolEffects.events.flatMap(createMessagesFromEvent),
        );
        if (toolResult.signal === "finish_round") {
          break;
        }
        shouldRunRound = true;
      }
      await this.persistRoundState({
        assistantMessage: assistantToPersist,
        toolPersistences: pendingPersistence,
      });
    }
  }

  public async hydrateStartupEvents(events: Event[]): Promise<void> {
    for (const event of events) {
      await this.session.consumeIncomingEvent(event);
    }
    const result = await this.session.flushPendingIncomingEffects();
    if (result.shouldTriggerRound) {
      await this.compactContextIfNeeded();
    }
  }

  private async consumePendingEvents(): Promise<{ shouldTriggerRound: boolean }> {
    while (true) {
      const event = this.eventQueue.dequeue();
      if (!event) {
        break;
      }

      await this.session.consumeIncomingEvent(event);
    }

    const waitingTimeoutResult = await this.session.finishWaitingIfExpired(this.now());
    const result = await this.session.flushPendingIncomingEffects();
    await this.compactContextIfNeeded();
    return {
      shouldTriggerRound: result.shouldTriggerRound || waitingTimeoutResult.shouldTriggerRound,
    };
  }

  private async executeToolCall(
    toolName: string,
    argumentsValue: Record<string, unknown>,
    context: {
      groupId?: string;
      systemPrompt?: string;
      messages?: LlmMessage[];
      tools: ToolExecutor;
    },
  ): Promise<ToolSetExecutionResult> {
    const toolContext = {
      ...context,
      agentContext: this.context,
      rootAgentSession: this.session,
    };

    return await context.tools.execute(toolName, argumentsValue, toolContext);
  }

  private async persistRoundState(input: {
    assistantMessage: AssistantMessage | null;
    toolPersistences: PendingToolPersistence[];
  }): Promise<void> {
    let hasWrittenMessages = false;

    if (input.assistantMessage) {
      await this.context.appendAssistantTurn(input.assistantMessage);
      hasWrittenMessages = true;
    }

    for (const toolPersistence of input.toolPersistences) {
      if (toolPersistence.toolResult) {
        await this.context.appendToolResult(toolPersistence.toolResult);
        hasWrittenMessages = true;
      }

      if (toolPersistence.postToolEffects.messages.length > 0) {
        await this.context.appendMessages(toolPersistence.postToolEffects.messages);
        hasWrittenMessages = true;
      }

      if (toolPersistence.postToolEffects.events.length > 0) {
        await this.context.appendEvents(toolPersistence.postToolEffects.events);
        hasWrittenMessages = true;
      }
    }

    if (hasWrittenMessages) {
      await this.compactContextIfNeeded();
    }
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

    const summary =
      "execute" in this.contextSummaryOperation
        ? await this.contextSummaryOperation.execute({
            messages: snapshot.messages,
            tools: this.summaryTools,
          })
        : await this.contextSummaryOperation.summarize({
            messages: snapshot.messages,
            tools: this.summaryTools,
          });
    if (!summary) {
      return;
    }

    await this.context.replaceMessages([createConversationSummaryMessage(summary)]);
  }
}

async function createSleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
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
      toolCall =>
        agentTools.getKind(toolCall.name) !== "control" ||
        shouldPersistControlToolInContext(toolCall.name),
    ),
  };
}

function shouldPersistToolResultInContext(input: {
  toolName: string;
  toolResult: ToolSetExecutionResult;
}): boolean {
  return input.toolResult.kind !== "control" || shouldPersistControlToolInContext(input.toolName);
}

function shouldPersistControlToolInContext(toolName: string): boolean {
  return toolName === WAIT_TOOL_NAME;
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
