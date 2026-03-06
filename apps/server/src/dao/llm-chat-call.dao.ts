import type { LlmChatRequest, LlmChatResponse, LlmProviderId } from "../llm/types.js";

export type LlmChatCallStatus = "success" | "failed";

export type LlmChatCallItem = {
  id: number;
  requestId: string;
  provider: string;
  model: string;
  status: LlmChatCallStatus;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  latencyMs: number | null;
  createdAt: Date;
};

export type QueryLlmChatCallListInput = {
  page: number;
  pageSize: number;
};

type LlmChatCallBaseInput = {
  requestId: string;
  provider: LlmProviderId;
  model: string;
  latencyMs: number;
  request: LlmChatRequest;
};

export type RecordLlmChatCallSuccessInput = LlmChatCallBaseInput & {
  response: LlmChatResponse;
};

export type RecordLlmChatCallErrorInput = LlmChatCallBaseInput & {
  error: unknown;
};

export interface LlmChatCallDao {
  countAll(): Promise<number>;
  listPage(input: QueryLlmChatCallListInput): Promise<LlmChatCallItem[]>;
  recordSuccess(input: RecordLlmChatCallSuccessInput): Promise<void>;
  recordError(input: RecordLlmChatCallErrorInput): Promise<void>;
}
