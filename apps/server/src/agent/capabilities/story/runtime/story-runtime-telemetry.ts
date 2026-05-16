import type { LlmClient } from "../../../../llm/client.js";
import type { MetricService } from "../../../../metric/application/metric.service.js";
import { NOOP_METRIC_SERVICE, recordToolCallMetric } from "../../../runtime/tool-call-metric.js";
import { createPreview, safeJsonStringify } from "./story-runtime.utils.js";

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

export type StoryAgentLoopState =
  | "starting"
  | "idle"
  | "consuming_events"
  | "calling_llm"
  | "executing_tool"
  | "crashed";

export type StoryAgentRuntimeErrorSummary = {
  name: string;
  message: string;
  updatedAt: Date;
};

export type StoryAgentToolCallSummary = {
  name: string;
  argumentsPreview: string;
  updatedAt: Date;
};

export type StoryAgentLlmCallSummary = {
  provider: string;
  model: string;
  assistantContentPreview: string;
  toolCallNames: string[];
  totalTokens: number | null;
  updatedAt: Date;
};

export type StoryRuntimeTelemetryView = {
  loopState: StoryAgentLoopState;
  lastError: StoryAgentRuntimeErrorSummary | null;
  lastActivityAt: Date | null;
  lastRoundCompletedAt: Date | null;
  lastCompactionAt: Date | null;
  lastToolCall: StoryAgentToolCallSummary | null;
  lastToolResultPreview: string | null;
  lastLlmCall: StoryAgentLlmCallSummary | null;
};

type StoryRuntimeTelemetryDeps = {
  metricService?: MetricService;
  now?: () => Date;
};

/**
 * Story runtime 的"观测视图"持有者。所有面向 Dashboard / 日志的状态字段都聚集在此，
 * 不参与任何业务决策；外部组件只通过 record* / transition* 写入，read 通过 view() 一次性产出快照。
 */
export class StoryRuntimeTelemetry {
  private readonly metricService: MetricService;
  private readonly now: () => Date;
  private loopState: StoryAgentLoopState = "starting";
  private lastError: StoryAgentRuntimeErrorSummary | null = null;
  private lastActivityAt: Date | null = null;
  private lastRoundCompletedAt: Date | null = null;
  private lastCompactionAt: Date | null = null;
  private lastToolCall: StoryAgentToolCallSummary | null = null;
  private lastToolResultPreview: string | null = null;
  private lastLlmCall: StoryAgentLlmCallSummary | null = null;

  public constructor({ metricService, now }: StoryRuntimeTelemetryDeps = {}) {
    this.metricService = metricService ?? NOOP_METRIC_SERVICE;
    this.now = now ?? (() => new Date());
  }

  public transitionTo(loopState: StoryAgentLoopState): void {
    this.loopState = loopState;
  }

  public touchActivity(): void {
    this.lastActivityAt = this.now();
  }

  public recordRoundCompleted(): void {
    this.lastRoundCompletedAt = this.now();
    this.touchActivity();
    this.transitionTo("idle");
  }

  public recordCompactionCompleted(): void {
    this.lastCompactionAt = this.now();
    this.touchActivity();
  }

  public recordLlmCall(completion: StoryCompletion): void {
    this.clearRecoverableError();
    this.lastLlmCall = {
      provider: completion.provider,
      model: completion.model,
      assistantContentPreview: createPreview(completion.message.content),
      toolCallNames: completion.message.toolCalls.map(toolCall => toolCall.name),
      totalTokens: completion.usage?.totalTokens ?? null,
      updatedAt: this.now(),
    };
    this.touchActivity();
  }

  public recordToolCall(input: {
    toolName: string;
    argumentsValue: Record<string, unknown>;
    resultContent: string;
  }): void {
    void recordToolCallMetric({
      metricService: this.metricService,
      runtime: "storyAgent",
      toolName: input.toolName,
      argumentsValue: input.argumentsValue,
    });

    this.lastToolCall = {
      name: input.toolName,
      argumentsPreview: createPreview(safeJsonStringify(input.argumentsValue)),
      updatedAt: this.now(),
    };
    this.lastToolResultPreview =
      input.resultContent.trim().length > 0 ? createPreview(input.resultContent) : null;
    this.touchActivity();
  }

  public recordRecoverableError(error: unknown): void {
    this.lastError = {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      updatedAt: this.now(),
    };
    this.touchActivity();
  }

  public clearRecoverableError(): void {
    this.lastError = null;
  }

  public recordCrash(error: unknown): void {
    this.loopState = "crashed";
    this.lastError = {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      updatedAt: this.now(),
    };
    this.touchActivity();
  }

  public view(): StoryRuntimeTelemetryView {
    return {
      loopState: this.loopState,
      lastError: cloneErrorSummary(this.lastError),
      lastActivityAt: cloneDate(this.lastActivityAt),
      lastRoundCompletedAt: cloneDate(this.lastRoundCompletedAt),
      lastCompactionAt: cloneDate(this.lastCompactionAt),
      lastToolCall: cloneToolCallSummary(this.lastToolCall),
      lastToolResultPreview: this.lastToolResultPreview,
      lastLlmCall: cloneLlmCallSummary(this.lastLlmCall),
    };
  }
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function cloneErrorSummary(
  value: StoryAgentRuntimeErrorSummary | null,
): StoryAgentRuntimeErrorSummary | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    updatedAt: new Date(value.updatedAt),
  };
}

function cloneToolCallSummary(
  value: StoryAgentToolCallSummary | null,
): StoryAgentToolCallSummary | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    updatedAt: new Date(value.updatedAt),
  };
}

function cloneLlmCallSummary(
  value: StoryAgentLlmCallSummary | null,
): StoryAgentLlmCallSummary | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    updatedAt: new Date(value.updatedAt),
  };
}
