import { db } from "../db/client.js";
import { llmChatCall } from "../db/schema.js";
import type { LlmChatRequest, LlmChatResponse, LlmProviderId } from "./types.js";

type LlmChatCallBaseInput = {
  requestId: string;
  provider: LlmProviderId;
  model: string;
  latencyMs: number;
  request: LlmChatRequest;
};

type RecordLlmChatCallSuccessInput = LlmChatCallBaseInput & {
  response: LlmChatResponse;
};

type RecordLlmChatCallErrorInput = LlmChatCallBaseInput & {
  error: unknown;
};

export function recordLlmChatCallSuccess(input: RecordLlmChatCallSuccessInput): void {
  void db
    .insert(llmChatCall)
    .values({
      requestId: input.requestId,
      provider: input.provider,
      model: input.response.model,
      status: "success",
      requestPayload: toJsonRecord(input.request),
      responsePayload: toJsonRecord(input.response),
      latencyMs: input.latencyMs,
    })
    .catch((error: unknown) => {
      logRecordFailure(input.requestId, error);
    });
}

export function recordLlmChatCallError(input: RecordLlmChatCallErrorInput): void {
  void db
    .insert(llmChatCall)
    .values({
      requestId: input.requestId,
      provider: input.provider,
      model: input.model,
      status: "failed",
      requestPayload: toJsonRecord(input.request),
      error: serializeError(input.error),
      latencyMs: input.latencyMs,
    })
    .catch((error: unknown) => {
      logRecordFailure(input.requestId, error);
    });
}

function logRecordFailure(requestId: string, error: unknown): void {
  console.error(
    JSON.stringify(
      {
        event: "llm.chat_call_record.error",
        scope: "llm",
        timestamp: new Date().toISOString(),
        requestId,
        error: serializeError(error),
      },
      null,
      2,
    ),
  );
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: getErrorCode(error),
    };
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? error : "Unknown error",
  };
}

function getErrorCode(error: Error): string | undefined {
  const maybeCode = (error as Error & { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : undefined;
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  return {
    value,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
