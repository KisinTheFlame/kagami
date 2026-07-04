import { describe, expect, it, vi } from "vitest";
import type {
  QueryTodoItemListInput,
  TodoItemQueryDao,
  TodoItemRow,
} from "@kagami/persistence/dao/todo-item.dao";
import { DefaultTodoQueryService } from "../../src/ops/application/todo-query.impl.service.js";

function makeDao(overrides: Partial<TodoItemQueryDao>): TodoItemQueryDao {
  return {
    countByQuery: vi.fn(),
    listPage: vi.fn(),
    ...overrides,
  };
}

const sampleRow: TodoItemRow = {
  id: 1,
  title: "写周报",
  note: null,
  status: "pending",
  remindAt: null,
  repeatEveryMs: null,
  snoozedUntil: null,
  createdAt: new Date("2026-04-01T00:00:00.000Z"),
  updatedAt: new Date("2026-04-01T00:00:00.000Z"),
  completedAt: null,
};

describe("DefaultTodoQueryService", () => {
  it("queryList should assemble count + page into a paginated response", async () => {
    const todoItemDao = makeDao({
      countByQuery: vi.fn().mockResolvedValue(3),
      listPage: vi.fn().mockResolvedValue([sampleRow]),
    });

    const service = new DefaultTodoQueryService({ todoItemDao });
    const result = await service.queryList({ page: 1, pageSize: 20, status: undefined });

    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 3 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 1,
      status: "pending",
      createdAt: expect.any(String),
    });
  });

  it("queryList should forward status filter to both dao calls", async () => {
    const countByQuery = vi.fn().mockResolvedValue(0);
    const listPage = vi.fn().mockResolvedValue([]);
    const todoItemDao = makeDao({ countByQuery, listPage });

    const service = new DefaultTodoQueryService({ todoItemDao });
    await service.queryList({ page: 2, pageSize: 20, status: "completed" });

    const expected: QueryTodoItemListInput = { page: 2, pageSize: 20, status: "completed" };
    expect(countByQuery).toHaveBeenCalledWith(expected);
    expect(listPage).toHaveBeenCalledWith(expected);
  });
});
