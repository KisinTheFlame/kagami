import { type NapcatQqMessageListResponse } from "@kagami/console-api/napcat-group-message";
import type { NapcatQqMessageWireItem } from "@kagami/napcat-api/query";

type MapNapcatQqMessageListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: NapcatQqMessageWireItem[];
};

/**
 * napcat 契约 wire item 与 console-api item 逐字段同形（时间已是 ISO 字符串），
 * 这里只负责把 {total, items} 装进 console 的分页信封。
 */
export function mapNapcatQqMessageList(
  input: MapNapcatQqMessageListInput,
): NapcatQqMessageListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items,
  };
}
