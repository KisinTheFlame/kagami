import type { Prisma } from "../../../generated/prisma/client.js";
import type { Database } from "../../../db/client.js";
import { AppLogger } from "../../../logger/logger.js";
import type {
  LlmChatCallItem,
  LlmChatCallDao,
  QueryLlmChatCallListInput,
  RecordLlmChatCallErrorInput,
  RecordLlmChatCallSuccessInput,
} from "../llm-chat-call.dao.js";

const logger = new AppLogger({ source: "dao.llm-chat-call" });

type PrismaLlmChatCallDaoDeps = {
  database: Database;
};

export class PrismaLlmChatCallDao implements LlmChatCallDao {
  private readonly database: Database;

  public constructor({ database }: PrismaLlmChatCallDaoDeps) {
    this.database = database;
  }

  public async countByQuery(input: QueryLlmChatCallListInput): Promise<number> {
    return this.database.llmChatCall.count({
      where: toWhereInput(input),
    });
  }

  public async listPage(input: QueryLlmChatCallListInput): Promise<LlmChatCallItem[]> {
    const offset = (input.page - 1) * input.pageSize;
    const rows = await this.database.llmChatCall.findMany({
      where: toWhereInput(input),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.pageSize,
      skip: offset,
    });

    return rows.map(item => ({
      id: item.id,
      requestId: item.requestId,
      loopRunId: item.loopRunId,
      seq: item.seq,
      provider: item.provider,
      model: item.model,
      extension: toOptionalJsonRecord(item.extension),
      status: item.status as LlmChatCallItem["status"],
      requestPayload: toJsonRecord(item.requestPayload),
      responsePayload: toOptionalJsonRecord(item.responsePayload),
      nativeRequestPayload: toOptionalJsonRecord(item.nativeRequestPayload),
      nativeResponsePayload: toOptionalJsonRecord(item.nativeResponsePayload),
      error: toOptionalJsonRecord(item.error),
      nativeError: toOptionalJsonRecord(item.nativeError),
      latencyMs: item.latencyMs,
      createdAt: item.createdAt,
    }));
  }

  public async recordSuccess(input: RecordLlmChatCallSuccessInput): Promise<void> {
    try {
      const extension = toOptionalInputJsonRecord(input.extension);
      const nativeRequestPayload = toOptionalInputJsonRecord(input.nativeRequestPayload);
      const nativeResponsePayload = toOptionalInputJsonRecord(input.nativeResponsePayload);
      await this.database.llmChatCall.create({
        data: {
          requestId: input.requestId,
          ...(input.loopRunId ? { loopRunId: input.loopRunId } : {}),
          seq: input.seq,
          provider: input.provider,
          model: input.model,
          ...(extension ? { extension } : {}),
          status: "success",
          requestPayload: toInputJsonRecord(input.request),
          responsePayload: toInputJsonRecord(input.response),
          ...(nativeRequestPayload ? { nativeRequestPayload } : {}),
          ...(nativeResponsePayload ? { nativeResponsePayload } : {}),
          latencyMs: input.latencyMs,
        },
      });
    } catch (error) {
      this.logRecordFailure({
        requestId: input.requestId,
        seq: input.seq,
        error,
      });
      throw error;
    }
  }

  public async recordError(input: RecordLlmChatCallErrorInput): Promise<void> {
    try {
      const extension = toOptionalInputJsonRecord(input.extension);
      const nativeRequestPayload = toOptionalInputJsonRecord(input.nativeRequestPayload);
      const nativeResponsePayload = toOptionalInputJsonRecord(input.nativeResponsePayload);
      const nativeError = toOptionalInputJsonRecord(input.nativeError);
      await this.database.llmChatCall.create({
        data: {
          requestId: input.requestId,
          ...(input.loopRunId ? { loopRunId: input.loopRunId } : {}),
          seq: input.seq,
          provider: input.provider,
          model: input.model,
          ...(extension ? { extension } : {}),
          status: "failed",
          requestPayload: toInputJsonRecord(input.request),
          ...(nativeRequestPayload ? { nativeRequestPayload } : {}),
          ...(input.response
            ? {
                responsePayload: toInputJsonRecord(input.response),
              }
            : {}),
          ...(nativeResponsePayload ? { nativeResponsePayload } : {}),
          error: toInputJsonRecord(serializeError(input.error)),
          ...(nativeError ? { nativeError } : {}),
          latencyMs: input.latencyMs,
        },
      });
    } catch (error) {
      this.logRecordFailure({
        requestId: input.requestId,
        seq: input.seq,
        error,
      });
      throw error;
    }
  }

  private logRecordFailure(input: { requestId: string; seq: number; error: unknown }): void {
    logger.error("Failed to record llm chat call", {
      event: "llm.chat_call_record.error",
      requestId: input.requestId,
      seq: input.seq,
      error: serializeError(input.error),
    });
  }
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

function toOptionalJsonRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  return toJsonRecord(value);
}

function toInputJsonRecord(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeInputJsonValue(value);
  if (typeof normalized === "object" && !Array.isArray(normalized)) {
    return normalized as Prisma.InputJsonObject;
  }

  return {
    value: normalized,
  };
}

function toOptionalInputJsonRecord(value: unknown): Prisma.InputJsonObject | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return toInputJsonRecord(value);
}

function normalizeInputJsonValue(value: unknown): Prisma.InputJsonValue {
  try {
    const serialized = JSON.stringify(value, (_key, currentValue) => {
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
  } catch {
    if (value instanceof Error) {
      return value.message;
    }

    return String(value);
  }
}

function toWhereInput(input: QueryLlmChatCallListInput): Prisma.LlmChatCallWhereInput {
  return {
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
}
