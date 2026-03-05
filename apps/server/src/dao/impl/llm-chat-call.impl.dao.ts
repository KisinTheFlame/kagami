import { count, desc } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { llmChatCall } from "../../db/schema.js";
import { AppLogger } from "../../logger/logger.js";
import type {
  LlmChatCallItem,
  LlmChatCallDao,
  QueryLlmChatCallListInput,
  RecordLlmChatCallErrorInput,
  RecordLlmChatCallSuccessInput,
} from "../llm-chat-call.dao.js";

const logger = new AppLogger({ source: "dao.llm-chat-call" });

type DrizzleLlmChatCallDaoDeps = {
  database: Database;
};

export class DrizzleLlmChatCallDao implements LlmChatCallDao {
  private readonly database: Database;

  public constructor({ database }: DrizzleLlmChatCallDaoDeps) {
    this.database = database;
  }

  public async countAll(): Promise<number> {
    const [{ total }] = await this.database.select({ total: count() }).from(llmChatCall);
    return total;
  }

  public async listPage(input: QueryLlmChatCallListInput): Promise<LlmChatCallItem[]> {
    const offset = (input.page - 1) * input.pageSize;
    return this.database
      .select()
      .from(llmChatCall)
      .orderBy(desc(llmChatCall.createdAt), desc(llmChatCall.id))
      .limit(input.pageSize)
      .offset(offset);
  }

  public async recordSuccess(input: RecordLlmChatCallSuccessInput): Promise<void> {
    try {
      await this.database.insert(llmChatCall).values({
        requestId: input.requestId,
        provider: input.provider,
        model: input.response.model,
        status: "success",
        requestPayload: toJsonRecord(input.request),
        responsePayload: toJsonRecord(input.response),
        latencyMs: input.latencyMs,
      });
    } catch (error) {
      this.logRecordFailure(input.requestId, error);
      throw error;
    }
  }

  public async recordError(input: RecordLlmChatCallErrorInput): Promise<void> {
    try {
      await this.database.insert(llmChatCall).values({
        requestId: input.requestId,
        provider: input.provider,
        model: input.model,
        status: "failed",
        requestPayload: toJsonRecord(input.request),
        error: serializeError(input.error),
        latencyMs: input.latencyMs,
      });
    } catch (error) {
      this.logRecordFailure(input.requestId, error);
      throw error;
    }
  }

  private logRecordFailure(requestId: string, error: unknown): void {
    logger.error("Failed to record llm chat call", {
      event: "llm.chat_call_record.error",
      requestId,
      error: serializeError(error),
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
