import type { LogMetadata } from "./types.js";

export function serializeMetadata(metadata: LogMetadata): LogMetadata {
  const serialized = toSerializable(metadata);
  return isRecord(serialized) ? serialized : { value: serialized };
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const withDetails = error as Error & {
      code?: unknown;
      cause?: unknown;
      meta?: unknown;
      statusCode?: unknown;
    };

    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: typeof withDetails.code === "string" ? withDetails.code : undefined,
      cause:
        typeof withDetails.cause === "undefined" ? undefined : toSerializable(withDetails.cause),
      meta: typeof withDetails.meta === "undefined" ? undefined : toSerializable(withDetails.meta),
      statusCode: typeof withDetails.statusCode === "number" ? withDetails.statusCode : undefined,
    };
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? error : "Unknown error",
    detail: toSerializable(error),
  };
}

function toSerializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value, jsonReplacer));
  } catch {
    return {
      type: typeof value,
      value: String(value),
    };
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
