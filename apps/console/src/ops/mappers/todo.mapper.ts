import { type TodoItem, type TodoListResponse } from "@kagami/console-api/todo";
import type { TodoItemRow } from "@kagami/persistence/dao/todo-item.dao";

type MapTodoListInput = {
  page: number;
  pageSize: number;
  total: number;
  items: TodoItemRow[];
};

export function mapTodoList(input: MapTodoListInput): TodoListResponse {
  return {
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total,
    },
    items: input.items.map(mapTodoItem),
  };
}

function mapTodoItem(row: TodoItemRow): TodoItem {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    status: row.status,
    remindAt: row.remindAt?.toISOString() ?? null,
    // DB 列是无约束 Int?；把 <=0（legacy / 手工写入）归一成 null，
    // 既符合「0 = 无重复」语义，也保证契约 .positive().nullable() 恒成立，
    // 免得一条坏行让整页只读查询在 output.parse 时 500。
    repeatEveryMs: row.repeatEveryMs !== null && row.repeatEveryMs > 0 ? row.repeatEveryMs : null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
