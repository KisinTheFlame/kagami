import type { LlmProviderId } from "@kagami/server-core/common/contracts/llm";

export type LlmChatCallStatus = "success" | "failed";

export type LlmChatCallSummary = {
  id: number;
  requestId: string;
  seq: number;
  provider: string;
  model: string;
  extension: Record<string, unknown> | null;
  status: LlmChatCallStatus;
  latencyMs: number | null;
  createdAt: Date;
};

export type LlmChatCallItem = LlmChatCallSummary & {
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown> | null;
  nativeRequestPayload: Record<string, unknown> | null;
  nativeResponsePayload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  nativeError: Record<string, unknown> | null;
};

export type QueryLlmChatCallListInput = {
  page: number;
  pageSize: number;
  provider?: string;
  model?: string;
  status?: LlmChatCallStatus;
};

type LlmChatCallBaseInput = {
  requestId: string;
  seq: number;
  provider: LlmProviderId;
  model: string;
  extension?: Record<string, unknown> | null;
  latencyMs: number;
  request: Record<string, unknown>;
  nativeRequestPayload?: Record<string, unknown> | null;
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
  recordSuccess(input: RecordLlmChatCallSuccessInput): Promise<void>;
  recordError(input: RecordLlmChatCallErrorInput): Promise<void>;
}
