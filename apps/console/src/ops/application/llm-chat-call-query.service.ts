import {
  type LlmChatCallDetailResponse,
  type LlmChatCallListQuery,
  type LlmChatCallListResponse,
} from "@kagami/shared/schemas/llm-chat";

export interface LlmChatCallQueryService {
  queryList(query: LlmChatCallListQuery): Promise<LlmChatCallListResponse>;
  getDetail(id: number): Promise<LlmChatCallDetailResponse>;
}
