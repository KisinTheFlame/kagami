import type { LlmProviderId } from "@kagami/llm";

export type LlmChatCallStatus = "success" | "failed";

export type LlmChatCallSummary = {
  id: number;
  requestId: string;
  seq: number;
  provider: string;
  model: string;
  /** 调用归因（自由 string）；chatDirect 无归因时为 null。 */
  scene: string | null;
  extension: Record<string, unknown> | null;
  status: LlmChatCallStatus;
  latencyMs: number | null;
  createdAt: Date;
};

export type LlmChatCallItem = LlmChatCallSummary & {
  /** 由 `request_skeleton` + `message_refs` 指向的 blob 重组还原，与写入时逐字段深度相等。 */
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown> | null;
  nativeResponsePayload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  nativeError: Record<string, unknown> | null;
};

/** GC mark 阶段用：一行的全部 blob 引用来源。 */
export type LlmChatCallRefRow = {
  id: number;
  messageRefs: Uint8Array;
  requestSkeleton: unknown;
};

/** 一次落库实际产生的 blob 写入量（喂 metric，不参与控制流）。 */
export type LlmChatCallWriteStats = {
  /** 本次调用的 blob 引用总数（messages + system + tools）。 */
  referenceCount: number;
  /** 其中真正新插入的 blob 行数。 */
  insertedBlobCount: number;
  /** 新插入 blob 的入库字节之和（压缩后口径）。 */
  insertedStoredBytes: number;
};

export type QueryLlmChatCallListInput = {
  page: number;
  pageSize: number;
  provider?: string;
  model?: string;
  scene?: string;
  status?: LlmChatCallStatus;
};

type LlmChatCallBaseInput = {
  requestId: string;
  seq: number;
  provider: LlmProviderId;
  model: string;
  /** 调用归因（自由 string）；chatDirect 无归因时传 null。 */
  scene?: string | null;
  extension?: Record<string, unknown> | null;
  latencyMs: number;
  request: Record<string, unknown>;
  nativeResponsePayload?: Record<string, unknown> | null;
  nativeError?: Record<string, unknown> | null;
};

export type RecordLlmChatCallSuccessInput = LlmChatCallBaseInput & {
  response: Record<string, unknown>;
};

export type RecordLlmChatCallErrorInput = LlmChatCallBaseInput & {
  error: unknown;
  response?: Record<string, unknown>;
};

export interface LlmChatCallDao {
  countByQuery(input: QueryLlmChatCallListInput): Promise<number>;
  listPage(input: QueryLlmChatCallListInput): Promise<LlmChatCallSummary[]>;
  findById(id: number): Promise<LlmChatCallItem | null>;
  recordSuccess(input: RecordLlmChatCallSuccessInput): Promise<LlmChatCallWriteStats>;
  recordError(input: RecordLlmChatCallErrorInput): Promise<LlmChatCallWriteStats>;
  /** GC mark 阶段：按 id 升序游标翻页读出全部存活行的 blob 引用。 */
  listRefPage(input: { afterId: number; limit: number }): Promise<LlmChatCallRefRow[]>;
}
