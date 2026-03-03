import type { LlmChatRequest, LlmChatResponse, LlmProviderId } from "./types.js";

type LlmLogContext = {
  provider: LlmProviderId;
  model: string;
  requestId: string;
};

type LlmRequestLogInput = LlmLogContext & {
  request: LlmChatRequest;
};

type LlmResponseLogInput = LlmLogContext & {
  latencyMs: number;
  request: LlmChatRequest;
  response: LlmChatResponse;
};

type LlmErrorLogInput = LlmLogContext & {
  latencyMs: number;
  request: LlmChatRequest;
  error: unknown;
};

export function logLlmRequest(input: LlmRequestLogInput): void {
  emitLog("llm.request", {
    scope: "llm",
    timestamp: new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    requestId: input.requestId,
    payload: input.request,
  });
}

export function logLlmResponse(input: LlmResponseLogInput): void {
  emitLog("llm.response", {
    scope: "llm",
    timestamp: new Date().toISOString(),
    provider: input.provider,
    model: input.response.model,
    requestId: input.requestId,
    latencyMs: input.latencyMs,
    usage: input.response.usage,
    payload: {
      request: input.request,
      response: input.response,
    },
  });
}

export function logLlmError(input: LlmErrorLogInput): void {
  emitLog("llm.error", {
    scope: "llm",
    timestamp: new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    requestId: input.requestId,
    latencyMs: input.latencyMs,
    payload: input.request,
    error: serializeError(input.error),
  });
}

function emitLog(event: "llm.request" | "llm.response" | "llm.error", payload: Record<string, unknown>): void {
  console.log(
    JSON.stringify(
      {
        event,
        ...payload,
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
