import { type AppLogListResponse } from "@kagami/console-api/app-log";
import type { AgentAppLogWireItem } from "@kagami/agent-api/ops-query";

type MapAppLogListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: AgentAppLogWireItem[];
};

/**
 * agent 契约 wire item 与 console-api item 逐字段同形（时间已是 ISO 字符串），
 * 这里只负责把 {total, items} 装进 console 的分页信封。
 */
export function mapAppLogList(input: MapAppLogListInput): AppLogListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items,
  };
}
