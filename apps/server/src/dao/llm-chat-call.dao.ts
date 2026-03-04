import type { InferSelectModel } from "drizzle-orm";
import { llmChatCall } from "../db/schema.js";
import type { LlmChatRequest, LlmChatResponse, LlmProviderId } from "../llm/types.js";

export type LlmChatCallItem = InferSelectModel<typeof llmChatCall>;

export type QueryLlmChatCallListInput = {
  page: number;
  pageSize: number;
};

export type QueryLlmChatCallListDaoResult = {
  page: number;
  pageSize: number;
  hasMore: boolean;
  items: LlmChatCallItem[];
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
  listPaginated(input: QueryLlmChatCallListInput): Promise<QueryLlmChatCallListDaoResult>;
  recordSuccess(input: RecordLlmChatCallSuccessInput): Promise<void>;
  recordError(input: RecordLlmChatCallErrorInput): Promise<void>;
}
