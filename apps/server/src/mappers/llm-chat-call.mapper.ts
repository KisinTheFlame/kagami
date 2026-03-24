import type { LlmChatCallItem, LlmChatCallListResponse } from "@kagami/shared";
import type { LlmChatCallItem as LlmChatCallDaoItem } from "../dao/llm-chat-call.dao.js";

type MapLlmChatCallListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: LlmChatCallDaoItem[];
};

export function mapLlmChatCallList(input: MapLlmChatCallListInput): LlmChatCallListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items.map(mapLlmChatCallItem),
  };
}

export function mapLlmChatCallItem(item: LlmChatCallDaoItem): LlmChatCallItem {
  return {
    id: item.id,
    requestId: item.requestId,
    seq: item.seq,
    provider: item.provider,
    model: item.model,
    extension: item.extension,
    status: item.status,
    requestPayload: item.requestPayload,
    responsePayload: item.responsePayload,
    nativeRequestPayload: item.nativeRequestPayload,
    nativeResponsePayload: item.nativeResponsePayload,
    error: item.error,
    nativeError: item.nativeError,
    latencyMs: item.latencyMs,
    createdAt: item.createdAt.toISOString(),
  };
}
