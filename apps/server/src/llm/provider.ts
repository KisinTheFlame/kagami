import type { LlmProviderId } from "../common/contracts/llm.js";
import type { LlmChatRequest, LlmChatResponsePayload } from "./types.js";

export type LlmProviderChatResult = {
  response: LlmChatResponsePayload;
  nativeRequestPayload: Record<string, unknown>;
  nativeResponsePayload: Record<string, unknown> | null;
};

export type LlmProviderFailureContext = {
  nativeRequestPayload?: Record<string, unknown> | null;
  nativeResponsePayload?: Record<string, unknown> | null;
  nativeError?: Record<string, unknown> | null;
};

const LLM_PROVIDER_FAILURE_CONTEXT = Symbol("llmProviderFailureContext");

type ErrorWithLlmProviderFailureContext = Error & {
  [LLM_PROVIDER_FAILURE_CONTEXT]?: LlmProviderFailureContext;
};

export interface LlmProvider {
  id: LlmProviderId;
  isAvailable?(): Promise<boolean>;
  chat(request: LlmChatRequest): Promise<LlmProviderChatResult>;
}

export function attachLlmProviderFailureContext<TError extends Error>(
  error: TError,
  context: LlmProviderFailureContext,
): TError {
  const target = error as ErrorWithLlmProviderFailureContext;
  target[LLM_PROVIDER_FAILURE_CONTEXT] = {
    nativeRequestPayload: context.nativeRequestPayload ?? null,
    nativeResponsePayload: context.nativeResponsePayload ?? null,
    nativeError: context.nativeError ?? null,
  };
  return error;
}

export function getLlmProviderFailureContext(error: unknown): LlmProviderFailureContext | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const context = (error as ErrorWithLlmProviderFailureContext)[LLM_PROVIDER_FAILURE_CONTEXT];
  return context ?? null;
}

export function toSerializableLlmNativeRecord(value: unknown): Record<string, unknown> {
  const serialized = toSerializableLlmNativeValue(value);
  if (isRecord(serialized)) {
    return serialized;
  }

  return {
    value: serialized,
  };
}

export function toSerializableLlmNativeRecordOrNull(
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toSerializableLlmNativeRecord(value);
}

function toSerializableLlmNativeValue(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value, (_key, currentValue) => {
      if (currentValue instanceof Error) {
        const withStatus = currentValue as Error & { status?: unknown; code?: unknown };
        return {
          name: currentValue.name,
          message: currentValue.message,
          stack: currentValue.stack,
          status: typeof withStatus.status === "number" ? withStatus.status : undefined,
          code: typeof withStatus.code === "string" ? withStatus.code : undefined,
        };
      }

      if (currentValue instanceof Date) {
        return currentValue.toISOString();
      }

      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }

      if (typeof currentValue === "function") {
        return `[Function ${currentValue.name || "anonymous"}]`;
      }

      if (typeof currentValue === "symbol") {
        return currentValue.toString();
      }

      return currentValue;
    });

    if (serialized === undefined) {
      return "undefined";
    }

    return JSON.parse(serialized) as unknown;
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
