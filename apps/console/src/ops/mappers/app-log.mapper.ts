import { type AppLogListResponse } from "@kagami/console-api/app-log";
import type { LogWireItem } from "@kagami/observatory-api/log";

type MapAppLogListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: LogWireItem[];
};

/**
 * observatory 契约 wire item 与 console-api item 逐字段同形（时间已是 ISO 字符串），
 * 这里只负责把 {total, items} 装进 console 的分页信封。
 *
 * 数据属主自 #608 起从 agent 换成 observatory；console 这一层的职责没变——纯转发聚合。
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
