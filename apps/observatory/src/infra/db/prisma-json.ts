import { isRecord } from "@kagami/kernel/json/is-record";

import type * as Prisma from "../../generated/prisma/internal/prismaNamespace.js";

/** 安全描述值的类型，绝不二次抛错（构造标记/日志时用）。 */
function describeValueType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return value.constructor?.name ?? "object";
  }
  return typeof value;
}

export function toJsonRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  return {
    value,
  };
}

export function toInputJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const normalized = normalizeInputJsonValue(value);
  if (typeof normalized === "object" && normalized !== null && !Array.isArray(normalized)) {
    return normalized as Prisma.InputJsonObject;
  }

  return {
    value: normalized,
  };
}

function normalizeInputJsonValue(value: unknown): Prisma.InputJsonValue {
  try {
    const serialized = JSON.stringify(value, (_key: string, currentValue: unknown) => {
      if (currentValue instanceof Date) {
        return currentValue.toISOString();
      }
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }
      if (typeof currentValue === "function" || typeof currentValue === "symbol") {
        return undefined;
      }
      return currentValue;
    });

    if (serialized === undefined) {
      return "undefined";
    }

    const parsed = JSON.parse(serialized) as unknown;
    if (parsed === null) {
      return "null";
    }

    return parsed as Prisma.InputJsonValue;
  } catch (error) {
    // 序列化失败（最常见是循环引用）。绝不静默降级成 "[object Object]" 把真实内容丢掉——
    // 记结构化诊断 + 返回可追溯标记。
    //
    // 与 napcat / persistence 的同名 helper 有意不同：这里**直写 stderr 而非 AppLogger**。
    // 本函数位于 observatory 落日志的写路径上（DbLogSink → insertBatch → 本函数），用 AppLogger
    // 就是往自己正在失败的那条路径上再喂一条日志。
    process.stderr.write(
      `${JSON.stringify({
        event: "observatory.prisma_json.serialize_failed",
        timestamp: new Date().toISOString(),
        valueType: describeValueType(value),
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );

    if (value instanceof Error) {
      return value.message;
    }

    return {
      __unserializable: true,
      reason: error instanceof Error ? error.message : String(error),
      valueType: describeValueType(value),
    };
  }
}
