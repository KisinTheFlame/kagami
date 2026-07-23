import { type TodoListResponse } from "@kagami/console-api/todo";
import type { AgentTodoWireItem } from "@kagami/agent-api/ops-query";

type MapTodoListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: AgentTodoWireItem[];
};

/**
 * agent 契约 wire item 与 console-api item 逐字段同形（时间已是 ISO 字符串、
 * repeatEveryMs 归一在 agent 侧完成），这里只负责把 {total, items} 装进分页信封。
 */
export function mapTodoList(input: MapTodoListInput): TodoListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items,
  };
}
