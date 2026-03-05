import type { LlmChatCallListQuery, LlmChatCallListResponse } from "@kagami/shared";

export interface LlmChatCallQueryService {
  queryList(query: LlmChatCallListQuery): Promise<LlmChatCallListResponse>;
}
