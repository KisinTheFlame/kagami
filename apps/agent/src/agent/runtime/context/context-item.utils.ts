import type { LlmMessage } from "@kagami/llm-client";
import type { ContextItem } from "./agent-context.js";
import type { Event } from "../event/event.js";
import { createMessagesFromEvent } from "./context-message-factory.js";

export function createContextItemFromEvent(event: Event): ContextItem {
  return {
    kind: "event",
    event,
  };
}

export function createContextItemFromMessage(message: LlmMessage): ContextItem {
  return {
    kind: "llm_message",
    message,
  };
}

export function renderContextItemToMessages(item: ContextItem): LlmMessage[] {
  if (item.kind === "llm_message") {
    return [item.message];
  }

  return createMessagesFromEvent(item.event);
}

export function serializeLlmMessage(message: LlmMessage): Record<string, unknown> {
  return normalizeStructuredValue(message) as Record<string, unknown>;
}

export function deserializeLlmMessage(value: unknown): LlmMessage {
  const revived = reviveStructuredValue(value);
  if (!isLlmMessage(revived)) {
    throw new Error("Invalid ledger rendered message payload");
  }

  return revived;
}

function normalizeStructuredValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return {
      type: "Buffer",
      data: [...value.values()],
    };
  }

  if (Array.isArray(value)) {
    return value.map(normalizeStructuredValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, normalizeStructuredValue(entryValue)]),
    );
  }

  return value;
}

function reviveStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reviveStructuredValue);
  }

  if (value && typeof value === "object") {
    if (isSerializedBuffer(value)) {
      return Buffer.from(value.data);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, reviveStructuredValue(entryValue)]),
    );
  }

  return value;
}

function isSerializedBuffer(value: unknown): value is { type: "Buffer"; data: number[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "Buffer" &&
    "data" in value &&
    Array.isArray(value.data) &&
    value.data.every(item => typeof item === "number")
  );
}

function isLlmMessage(value: unknown): value is LlmMessage {
  if (typeof value !== "object" || value === null || !("role" in value)) {
    return false;
  }

  switch (value.role) {
    case "user":
      return "content" in value;
    case "assistant":
      return "content" in value && "toolCalls" in value && Array.isArray(value.toolCalls);
    case "tool":
      return "toolCallId" in value && "content" in value;
    default:
      return false;
  }
}
