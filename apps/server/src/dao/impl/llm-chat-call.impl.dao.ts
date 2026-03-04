import { desc } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { llmChatCall } from "../../db/schema.js";
import type {
  LlmChatCallDao,
  QueryLlmChatCallListInput,
  QueryLlmChatCallListDaoResult,
  RecordLlmChatCallErrorInput,
  RecordLlmChatCallSuccessInput,
} from "../llm-chat-call.dao.js";

export class DrizzleLlmChatCallDao implements LlmChatCallDao {
  public constructor(private readonly database: Database) {}

  public async listPaginated(
    input: QueryLlmChatCallListInput,
  ): Promise<QueryLlmChatCallListDaoResult> {
    const offset = (input.page - 1) * input.pageSize;
    const rows = await this.database
      .select()
      .from(llmChatCall)
      .orderBy(desc(llmChatCall.createdAt), desc(llmChatCall.id))
      .limit(input.pageSize + 1)
      .offset(offset);

    const hasMore = rows.length > input.pageSize;
    const items = hasMore ? rows.slice(0, input.pageSize) : rows;

    return {
      page: input.page,
      pageSize: input.pageSize,
      hasMore,
      items,
    };
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
