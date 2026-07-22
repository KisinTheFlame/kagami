import {
  type LlmChatCallDetailResponse,
  type LlmChatCallListResponse,
} from "@kagami/console-api/llm-chat-call";
import type { LlmChatCallWireDetail, LlmChatCallWireSummary } from "@kagami/llm-api/query";

type MapLlmChatCallListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: LlmChatCallWireSummary[];
};

/**
 * llm 契约 wire item 与 console-api item 逐字段同形（时间已是 ISO 字符串），
 * 这里只负责把 {total, items} 装进 console 的分页信封。
 */
export function mapLlmChatCallList(input: MapLlmChatCallListInput): LlmChatCallListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items,
  };
}

export function mapLlmChatCallDetail(item: LlmChatCallWireDetail): LlmChatCallDetailResponse {
  return item;
}
