import type * as Prisma from "../../generated/prisma/internal/prismaNamespace.js";
import { toJsonRecord, toInputJsonObject } from "../db/prisma-json.js";
import type { Database } from "../db/client.js";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { packRefs, toDbBytes, unpackRefs } from "../../app/llm-payload-codec.js";
import {
  assembleRequestPayload,
  buildRequestSkeleton,
  parseRequestSkeleton,
  splitRequestPayload,
} from "../../app/llm-request-payload.js";
import type { LlmBlobDao } from "../llm-blob.dao.js";
import type {
  LlmChatCallItem,
  LlmChatCallDao,
  LlmChatCallRefRow,
  LlmChatCallStatus,
  LlmChatCallSummary,
  LlmChatCallWriteStats,
  QueryLlmChatCallListInput,
  RecordLlmChatCallErrorInput,
  RecordLlmChatCallSuccessInput,
} from "../llm-chat-call.dao.js";

const logger = new AppLogger({ source: "dao.llm-chat-call" });

type PrismaLlmChatCallDaoDeps = {
  database: Database;
  blobDao: LlmBlobDao;
};

/** 拆好的 blob 引用：写行时要的两列 + 喂 metric 的统计。 */
type ResolvedRequestColumns = {
  requestSkeleton: Prisma.InputJsonObject;
  messageRefs: Uint8Array<ArrayBuffer>;
  stats: LlmChatCallWriteStats;
};

export class PrismaLlmChatCallDao implements LlmChatCallDao {
  private readonly database: Database;
  private readonly blobDao: LlmBlobDao;

  public constructor({ database, blobDao }: PrismaLlmChatCallDaoDeps) {
    this.database = database;
    this.blobDao = blobDao;
  }

  public async countByQuery(input: QueryLlmChatCallListInput): Promise<number> {
    return this.database.llmChatCall.count({
      where: toWhereInput(input),
    });
  }

  public async listPage(input: QueryLlmChatCallListInput): Promise<LlmChatCallSummary[]> {
    const offset = (input.page - 1) * input.pageSize;
    const rows = await this.database.llmChatCall.findMany({
      where: toWhereInput(input),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.pageSize,
      skip: offset,
      select: {
        id: true,
        requestId: true,
        seq: true,
        provider: true,
        model: true,
        scene: true,
        extension: true,
        status: true,
        latencyMs: true,
        createdAt: true,
      },
    });

    return rows.map(item => ({
      id: item.id,
      requestId: item.requestId,
      seq: item.seq,
      provider: item.provider,
      model: item.model,
      scene: item.scene,
      extension: toOptionalJsonRecord(item.extension),
      status: item.status as LlmChatCallStatus,
      latencyMs: item.latencyMs,
      createdAt: item.createdAt,
    }));
  }

  public async findById(id: number): Promise<LlmChatCallItem | null> {
    const item = await this.database.llmChatCall.findUnique({
      where: { id },
    });
    if (item === null) {
      return null;
    }

    const skeleton = parseRequestSkeleton(item.requestSkeleton);
    const messageIds = unpackRefs(item.messageRefs);
    const referencedIds = [
      ...messageIds,
      ...(skeleton.systemBlobId === null ? [] : [skeleton.systemBlobId]),
      ...(skeleton.toolsBlobId === null ? [] : [skeleton.toolsBlobId]),
    ];
    const blobs = await this.blobDao.loadMany(referencedIds);

    return {
      id: item.id,
      requestId: item.requestId,
      seq: item.seq,
      provider: item.provider,
      model: item.model,
      scene: item.scene,
      extension: toOptionalJsonRecord(item.extension),
      status: item.status as LlmChatCallStatus,
      requestPayload: assembleRequestPayload({
        skeleton,
        systemRaw: takeBlob(blobs, skeleton.systemBlobId, item.id),
        toolsRaw: takeBlob(blobs, skeleton.toolsBlobId, item.id),
        messageRaws: messageIds.map(blobId => takeBlobRequired(blobs, blobId, item.id)),
      }),
      responsePayload: toOptionalJsonRecord(item.responsePayload),
      nativeResponsePayload: toOptionalJsonRecord(item.nativeResponsePayload),
      error: toOptionalJsonRecord(item.error),
      nativeError: toOptionalJsonRecord(item.nativeError),
      latencyMs: item.latencyMs,
      createdAt: item.createdAt,
    };
  }

  public async recordSuccess(input: RecordLlmChatCallSuccessInput): Promise<LlmChatCallWriteStats> {
    try {
      const extension = toOptionalInputJsonRecord(input.extension);
      const nativeResponsePayload = toOptionalInputJsonRecord(input.nativeResponsePayload);
      const columns = await this.resolveRequestColumns(input.request);
      await this.database.llmChatCall.create({
        data: {
          requestId: input.requestId,
          seq: input.seq,
          provider: input.provider,
          model: input.model,
          ...(input.scene ? { scene: input.scene } : {}),
          ...(extension ? { extension } : {}),
          status: "success",
          requestSkeleton: columns.requestSkeleton,
          messageRefs: columns.messageRefs,
          responsePayload: toInputJsonObject(input.response),
          ...(nativeResponsePayload ? { nativeResponsePayload } : {}),
          latencyMs: input.latencyMs,
        },
      });

      return columns.stats;
    } catch (error) {
      this.logRecordFailure({
        requestId: input.requestId,
        seq: input.seq,
        error,
      });
      throw error;
    }
  }

  public async recordError(input: RecordLlmChatCallErrorInput): Promise<LlmChatCallWriteStats> {
    try {
      const extension = toOptionalInputJsonRecord(input.extension);
      const nativeResponsePayload = toOptionalInputJsonRecord(input.nativeResponsePayload);
      const nativeError = toOptionalInputJsonRecord(input.nativeError);
      const columns = await this.resolveRequestColumns(input.request);
      await this.database.llmChatCall.create({
        data: {
          requestId: input.requestId,
          seq: input.seq,
          provider: input.provider,
          model: input.model,
          ...(input.scene ? { scene: input.scene } : {}),
          ...(extension ? { extension } : {}),
          status: "failed",
          requestSkeleton: columns.requestSkeleton,
          messageRefs: columns.messageRefs,
          ...(input.response
            ? {
                responsePayload: toInputJsonObject(input.response),
              }
            : {}),
          ...(nativeResponsePayload ? { nativeResponsePayload } : {}),
          error: toInputJsonObject(serializeError(input.error)),
          ...(nativeError ? { nativeError } : {}),
          latencyMs: input.latencyMs,
        },
      });

      return columns.stats;
    } catch (error) {
      this.logRecordFailure({
        requestId: input.requestId,
        seq: input.seq,
        error,
      });
      throw error;
    }
  }

  public async listRefPage(input: {
    afterId: number;
    limit: number;
  }): Promise<LlmChatCallRefRow[]> {
    return this.database.llmChatCall.findMany({
      where: { id: { gt: input.afterId } },
      select: { id: true, messageRefs: true, requestSkeleton: true },
      orderBy: { id: "asc" },
      take: input.limit,
    });
  }

  /**
   * 请求体拆成 blob 并解析成两列。**先写 blob 再写行**：中途失败最多留孤儿 blob（GC 自愈），
   * 反过来会让行引用不存在的 blob。
   */
  private async resolveRequestColumns(
    request: Record<string, unknown>,
  ): Promise<ResolvedRequestColumns> {
    const split = splitRequestPayload(request);
    // 一次解析全部引用（messages + system + tools），只走一趟去重与查询。
    const raws = [
      ...split.messageRaws,
      ...(split.systemRaw === null ? [] : [split.systemRaw]),
      ...(split.toolsRaw === null ? [] : [split.toolsRaw]),
    ];
    const resolved = await this.blobDao.resolveIds(raws);

    let cursor = split.messageRaws.length;
    const messageIds = resolved.ids.slice(0, cursor);
    const systemBlobId = split.systemRaw === null ? null : (resolved.ids[cursor++] ?? null);
    const toolsBlobId = split.toolsRaw === null ? null : (resolved.ids[cursor++] ?? null);

    const skeleton = buildRequestSkeleton(split, { systemBlobId, toolsBlobId });

    return {
      requestSkeleton: toInputJsonObject(skeleton as unknown as Record<string, unknown>),
      messageRefs: toDbBytes(packRefs(messageIds)),
      stats: {
        referenceCount: raws.length,
        insertedBlobCount: resolved.insertedCount,
        insertedStoredBytes: resolved.insertedStoredBytes,
      },
    };
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

/** 可空引用：id 为 null 时本来就没有这段内容。 */
function takeBlob(
  blobs: Map<number, Buffer>,
  blobId: number | null,
  callId: number,
): Buffer | null {
  if (blobId === null) {
    return null;
  }

  return takeBlobRequired(blobs, blobId, callId);
}

/**
 * 引用指向的 blob 必须存在。取不到说明 GC 误删或迁移出错——直接抛，让详情查询 500，
 * 绝不静默返回半截 payload（那会让人对着缺了几条 message 的历史做错误判断）。
 */
function takeBlobRequired(blobs: Map<number, Buffer>, blobId: number, callId: number): Buffer {
  const raw = blobs.get(blobId);
  if (raw === undefined) {
    throw new Error(`llm_chat_call#${callId} 引用的 llm_blob#${blobId} 不存在`);
  }

  return raw;
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

function toOptionalJsonRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  return toJsonRecord(value);
}

function toOptionalInputJsonRecord(value: unknown): Prisma.InputJsonObject | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return toInputJsonObject(value as Record<string, unknown>);
}

function toWhereInput(input: QueryLlmChatCallListInput): Prisma.LlmChatCallWhereInput {
  return {
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.scene ? { scene: input.scene } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
}
