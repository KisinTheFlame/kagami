import type { LlmChatCallItem, LlmChatCallListResponse } from "@kagami/shared";
import type {
  LlmChatCallItem as LlmChatCallDaoItem,
  QueryLlmChatCallListDaoResult,
} from "../dao/llm-chat-call.dao.js";

export function mapLlmChatCallList(result: QueryLlmChatCallListDaoResult): LlmChatCallListResponse {
  return {
    page: result.page,
    pageSize: result.pageSize,
    hasMore: result.hasMore,
    items: result.items.map(mapLlmChatCallItem),
  };
}

export function mapLlmChatCallItem(item: LlmChatCallDaoItem): LlmChatCallItem {
  return {
    id: item.id,
    requestId: item.requestId,
    provider: item.provider,
    model: item.model,
    status: item.status,
    requestPayload: item.requestPayload,
    responsePayload: item.responsePayload,
    error: item.error,
    latencyMs: item.latencyMs,
    createdAt: item.createdAt.toISOString(),
  };
}
