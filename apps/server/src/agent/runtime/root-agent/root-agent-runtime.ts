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
import type { RootAgentSessionController } from "./session/root-agent-session.js";

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
  portalTools?: ToolExecutor;
  groupTools?: ToolExecutor;
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

export class RootAgentRuntime {
  private readonly llmClient: LlmClient;
  private readonly context: AgentContext;
  private readonly eventQueue: AgentEventQueue;
  private readonly session: RootAgentSessionController;
  private readonly portalTools: ToolExecutor;
  private readonly groupTools: ToolExecutor;
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
    portalTools,
    groupTools,
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
    this.portalTools = portalTools ?? tools ?? agentTools ?? failMissingTools();
    this.groupTools = groupTools ?? tools ?? agentTools ?? failMissingTools();
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

      if (!shouldRunRound) {
        await this.sleep(10);
        continue;
      }
      shouldRunRound = false;

      await this.appendWakeReminderIfNeeded(this.now());

      const snapshot = await this.context.getSnapshot();
      const activeTools = this.getActiveTools();
      const completion = await this.llmClient.chat(
        {
          system: snapshot.systemPrompt,
          messages: snapshot.messages,
          tools: activeTools.definitions(),
          toolChoice: "required",
        },
        {
          usage: "agent",
        },
      );
      const assistant = completion.message;
      const persistentAssistantMessage = omitControlToolCalls(assistant, activeTools);
      if (shouldPersistAssistantMessage(persistentAssistantMessage)) {
        await this.context.appendAssistantTurn(persistentAssistantMessage);
        await this.compactContextIfNeeded();
      }

      let sleepMs: number | null = null;
      for (const toolCall of assistant.toolCalls) {
        const toolResult = await this.executeToolCall(toolCall.name, toolCall.arguments, {
          groupId: this.session.getCurrentGroupId(),
          systemPrompt: snapshot.systemPrompt,
          messages: snapshot.messages,
          tools: activeTools,
        });
        if (toolResult.content.length > 0) {
          await this.context.appendToolResult({
            toolCallId: toolCall.id,
            content: toolResult.content,
          });
          await this.compactContextIfNeeded();
        }
        await this.session.flushPendingPostToolEffects();
        await this.compactContextIfNeeded();
        if (toolResult.signal === "sleep") {
          sleepMs = toolResult.sleepMs ?? null;
          break;
        }
        if (toolResult.signal === "finish_round") {
          break;
        }
        shouldRunRound = true;
      }

      if (sleepMs !== null) {
        shouldRunRound = true;
        await this.sleep(sleepMs);
        continue;
      }
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

    const result = await this.session.flushPendingIncomingEffects();
    await this.compactContextIfNeeded();
    return result;
  }

  private async executeToolCall(
    toolName: string,
    argumentsValue: Record<string, unknown>,
    context: {
      groupId?: string;
      systemPrompt?: string;
      messages?: import("../../../llm/types.js").LlmMessage[];
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

  private getActiveTools(): ToolExecutor {
    return this.session.getState().kind === "portal" ? this.portalTools : this.groupTools;
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
