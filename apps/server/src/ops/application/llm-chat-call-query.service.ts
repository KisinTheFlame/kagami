import {
  type LlmChatCallListQuery,
  type LlmChatCallListResponse,
} from "@kagami/shared/schemas/llm-chat";

export interface LlmChatCallQueryService {
  queryList(query: LlmChatCallListQuery): Promise<LlmChatCallListResponse>;
}
