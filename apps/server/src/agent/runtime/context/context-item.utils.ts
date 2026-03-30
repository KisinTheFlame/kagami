import type { LlmContentPart, LlmMessage } from "../../../llm/types.js";
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

export function renderLlmMessagePlainText(message: LlmMessage): string {
  switch (message.role) {
    case "user":
      return renderUserMessageContent(message.content);
    case "assistant":
      return message.content.trim().length > 0
        ? message.content
        : `工具调用：${message.toolCalls.map(toolCall => toolCall.name).join(", ")}`;
    case "tool":
      return message.content;
  }
}

export function serializeContextItem(item: ContextItem): Record<string, unknown> {
  return normalizeStructuredValue(item) as Record<string, unknown>;
}

export function deserializeContextItem(value: unknown): ContextItem {
  const revived = reviveStructuredValue(value);
  if (!isContextItem(revived)) {
    throw new Error("Invalid ledger context item payload");
  }

  return revived;
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

function renderUserMessageContent(content: string | LlmContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map(part => {
      if (part.type === "text") {
        return part.text;
      }

      return `[图片${part.filename ? `:${part.filename}` : ""}]`;
    })
    .join("\n");
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

function isContextItem(value: unknown): value is ContextItem {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }

  if (value.kind === "llm_message") {
    return "message" in value;
  }

  if (value.kind === "event") {
    return "event" in value;
  }

  return false;
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
