import type { LlmChatRequest, LlmChatResponsePayload, LlmProviderId } from "../llm/types.js";

export type LlmChatCallStatus = "success" | "failed";

export type LlmChatCallItem = {
  id: number;
  requestId: string;
  seq: number;
  provider: string;
  model: string;
  status: LlmChatCallStatus;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown> | null;
  nativeRequestPayload: Record<string, unknown> | null;
  nativeResponsePayload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  nativeError: Record<string, unknown> | null;
  latencyMs: number | null;
  createdAt: Date;
};

export type QueryLlmChatCallListInput = {
  page: number;
  pageSize: number;
  status?: LlmChatCallStatus;
};

type LlmChatCallBaseInput = {
  requestId: string;
  seq: number;
  provider: LlmProviderId;
  model: string;
  latencyMs: number;
  request: LlmChatRequest;
  nativeRequestPayload?: Record<string, unknown> | null;
  nativeResponsePayload?: Record<string, unknown> | null;
  nativeError?: Record<string, unknown> | null;
};

export type RecordLlmChatCallSuccessInput = LlmChatCallBaseInput & {
  response: LlmChatResponsePayload;
};

export type RecordLlmChatCallErrorInput = LlmChatCallBaseInput & {
  error: unknown;
  response?: LlmChatResponsePayload;
};

export interface LlmChatCallDao {
  countByQuery(input: QueryLlmChatCallListInput): Promise<number>;
  listPage(input: QueryLlmChatCallListInput): Promise<LlmChatCallItem[]>;
  recordSuccess(input: RecordLlmChatCallSuccessInput): Promise<void>;
  recordError(input: RecordLlmChatCallErrorInput): Promise<void>;
}
