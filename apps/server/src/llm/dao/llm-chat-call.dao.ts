import type { LlmProviderId } from "../types.js";

export type LlmChatCallStatus = "success" | "failed";

export type LlmChatCallItem = {
  id: number;
  requestId: string;
  loopRunId: string | null;
  seq: number;
  provider: string;
  model: string;
  extension: Record<string, unknown> | null;
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
  provider?: string;
  model?: string;
  status?: LlmChatCallStatus;
};

type LlmChatCallBaseInput = {
  requestId: string;
  loopRunId?: string;
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
  listPage(input: QueryLlmChatCallListInput): Promise<LlmChatCallItem[]>;
  recordSuccess(input: RecordLlmChatCallSuccessInput): Promise<void>;
  recordError(input: RecordLlmChatCallErrorInput): Promise<void>;
}
