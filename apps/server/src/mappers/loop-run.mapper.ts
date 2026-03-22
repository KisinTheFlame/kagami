import type {
  JsonValue,
  LoopRunDetailResponse,
  LoopRunListItem,
  LoopRunListResponse,
  LoopRunTimelineItem,
} from "@kagami/shared";
import type { LoopRunItem, LoopRunStepItem } from "../dao/loop-run.dao.js";

export function mapLoopRunDetail(item: LoopRunItem): LoopRunDetailResponse {
  const trigger = mapTriggerPayload(item);
  const timeline = item.steps.map(mapLoopRunTimelineItem);
  const summary = buildSummary(timeline);

  return {
    id: item.id,
    status: item.status === "running" ? "partial" : item.status,
    startedAt: item.startedAt.toISOString(),
    finishedAt: item.finishedAt?.toISOString() ?? null,
    durationMs: item.durationMs,
    groupId: item.groupId,
    trigger,
    summary,
    timeline,
    raw: {
      triggerPayload: item.triggerPayload,
      steps: item.steps.map(step => ({
        id: step.id,
        seq: step.seq,
        type: step.type,
        title: step.title,
        status: step.status,
        payload: step.payload,
      })),
    },
  };
}

export function mapLoopRunList(input: {
  page: number;
  pageSize: number;
  total: number;
  items: LoopRunItem[];
}): LoopRunListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items.map(mapLoopRunListItem),
  };
}

export function mapLoopRunListItem(item: LoopRunItem): LoopRunListItem {
  const timeline = item.steps.map(mapLoopRunTimelineItem);

  return {
    id: item.id,
    status: item.status === "running" ? "partial" : item.status,
    groupId: item.groupId,
    startedAt: item.startedAt.toISOString(),
    finishedAt: item.finishedAt?.toISOString() ?? null,
    durationMs: item.durationMs,
    trigger: mapTriggerPayload(item),
    summary: buildSummary(timeline),
  };
}

export function mapLoopRunTimelineItem(step: LoopRunStepItem): LoopRunTimelineItem {
  const base = {
    id: String(step.id),
    seq: step.seq,
    title: step.title,
    status: step.status,
    startedAt: step.startedAt.toISOString(),
    finishedAt: step.finishedAt?.toISOString() ?? null,
    durationMs: step.durationMs,
  } as const;

  switch (step.type) {
    case "trigger_message":
      return {
        ...base,
        type: "trigger_message",
        trigger: mapTriggerFromStepPayload(step.payload),
      };
    case "llm_call":
      return {
        ...base,
        type: "llm_call",
        provider: getString(step.payload.provider, "unknown"),
        model: getString(step.payload.model, "unknown"),
        requestId: getString(step.payload.requestId, "unknown"),
        requestPayload: getRecord(step.payload.requestPayload),
        responsePayload: getNullableRecord(step.payload.responsePayload),
        usage: getNullableRecord(step.payload.usage),
        error: getNullableRecord(step.payload.error),
      };
    case "tool_call":
      return {
        ...base,
        type: "tool_call",
        toolName: getString(step.payload.toolName, "unknown"),
        toolCallId: getString(step.payload.toolCallId, "unknown"),
        arguments: getRecord(step.payload.arguments),
      };
    case "tool_result":
      return {
        ...base,
        type: "tool_result",
        toolName: getString(step.payload.toolName, "unknown"),
        toolCallId: getString(step.payload.toolCallId, "unknown"),
        result: getJsonValue(step.payload.result),
      };
    case "final_result":
    default:
      return {
        ...base,
        type: "final_result",
        outcome: getRecord(step.payload.outcome),
      };
  }
}

function mapTriggerPayload(item: LoopRunItem) {
  return mapTriggerFromStepPayload(item.triggerPayload);
}

function buildSummary(timeline: LoopRunTimelineItem[]) {
  return {
    llmCallCount: timeline.filter(step => step.type === "llm_call").length,
    toolCallCount: timeline.filter(step => step.type === "tool_call").length,
    toolSuccessCount: timeline.filter(
      step => step.type === "tool_result" && step.status === "success",
    ).length,
    toolFailureCount: timeline.filter(
      step => step.type === "tool_result" && step.status === "failed",
    ).length,
  };
}

function mapTriggerFromStepPayload(payload: Record<string, unknown>) {
  return {
    messageId: getNullableNumber(payload.messageId),
    groupId: getString(payload.groupId, "unknown"),
    userId: getString(payload.userId, "unknown"),
    nickname: getString(payload.nickname, "未知用户"),
    rawMessage: getString(payload.rawMessage, ""),
    messageSegments: getArray(payload.messageSegments),
    eventTime: getNullableIsoString(payload.eventTime),
  };
}

function getString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function getNullableIsoString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function getNullableRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  return getRecord(value);
}

function getArray(value: unknown): JsonValue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(item => toJsonValue(item));
}

function getJsonValue(value: unknown): JsonValue {
  return toJsonValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => toJsonValue(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
  }

  return String(value);
}
