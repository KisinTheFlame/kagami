import {
  type LlmChatCallDetailResponse,
  type LlmChatCallListResponse,
  type LlmChatCallSummary,
} from "@kagami/shared/schemas/llm-chat";
import type {
  LlmChatCallItem as LlmChatCallDaoItem,
  LlmChatCallSummary as LlmChatCallDaoSummary,
} from "../../llm/dao/llm-chat-call.dao.js";

type MapLlmChatCallListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: LlmChatCallDaoSummary[];
};

export function mapLlmChatCallList(input: MapLlmChatCallListInput): LlmChatCallListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items.map(mapLlmChatCallSummary),
  };
}

export function mapLlmChatCallSummary(item: LlmChatCallDaoSummary): LlmChatCallSummary {
  return {
    id: item.id,
    requestId: item.requestId,
    seq: item.seq,
    provider: item.provider,
    model: item.model,
    extension: item.extension,
    status: item.status,
    latencyMs: item.latencyMs,
    createdAt: item.createdAt.toISOString(),
  };
}

export function mapLlmChatCallDetail(item: LlmChatCallDaoItem): LlmChatCallDetailResponse {
  return {
    ...mapLlmChatCallSummary(item),
    requestPayload: item.requestPayload,
    responsePayload: item.responsePayload,
    nativeRequestPayload: item.nativeRequestPayload,
    nativeResponsePayload: item.nativeResponsePayload,
    error: item.error,
    nativeError: item.nativeError,
  };
}
